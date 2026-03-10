import { NextResponse } from 'next/server';
import { getBinanceEarnProducts } from '@/lib/exchanges/binanceEarn';
import { getBybitEarnProducts } from '@/lib/exchanges/bybitEarn';
import { getOkxEarnProducts } from '@/lib/exchanges/okxEarn';
import { getBatchMarketDataForSymbols } from '@/lib/marketData';
import { batchGetFundingStats, getOpenInterestMap } from '@/lib/fundingAggregator';

// 跳过构建时预渲染，由进程级缓存 + funding 缓存 控制刷新
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface EarnRate {
  exchange: string;
  apr: number;
}

export interface FundingRate {
  exchange: string;
  apr3d: number;
  apr7d: number;
}

export interface CombinedEarnRow {
  asset: string;
  earnRates: EarnRate[];
  bestEarnApr: number;
  bestEarnExchange: string;
  bestEarn3d: number;
  bestEarn7d: number;
  funding: FundingRate[];
  bestFunding3d: number;
  bestFunding7d: number;
  bestFundingExchange3d: string;
  bestFundingExchange7d: string;
  combined3d: number;
  combined7d: number;
  coinImage?: string;
  coinName?: string;
  openInterest: number | null;
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const CACHE_TTL_MS = 120 * 1000;
let cachedEarn: { data: CombinedEarnRow[]; timestamp: number } | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedEarn && now - cachedEarn.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(
        { success: true, data: cachedEarn.data, timestamp: cachedEarn.timestamp, cached: true },
      );
    }

    const [binanceProducts, bybitProducts, okxProducts] = await Promise.all([
      withTimeout(getBinanceEarnProducts(), 25000, []),
      withTimeout(getBybitEarnProducts(), 25000, []),
      withTimeout(getOkxEarnProducts(), 25000, []),
    ]);

    console.log(`[earn] Binance: ${binanceProducts.length}, Bybit: ${bybitProducts.length}, OKX: ${okxProducts.length}`);

    const EXCLUDED_ASSETS = new Set([
      'BETH',
      'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'USDD',
      'PYUSD', 'GUSD', 'FRAX', 'LUSD', 'SUSD', 'CUSD', 'EURC', 'EURI',
      'AEUR', 'UST', 'USTC', 'USDE', 'USDJ', 'DOLA', 'GHO', 'CRVUSD',
      'MKUSD', 'USD0',
    ]);
    const assetMap = new Map<string, Map<string, number>>();

    const addEarn = (asset: string, exchange: string, apr: number) => {
      const key = asset.toUpperCase();
      if (EXCLUDED_ASSETS.has(key)) return;
      if (!assetMap.has(key)) assetMap.set(key, new Map());
      const exchMap = assetMap.get(key)!;
      const existing = exchMap.get(exchange) ?? 0;
      if (apr > existing) exchMap.set(exchange, apr);
    };

    for (const p of binanceProducts) addEarn(p.asset, 'Binance', p.apr);
    for (const p of bybitProducts) addEarn(p.asset, 'Bybit', p.apr);
    for (const p of okxProducts) addEarn(p.asset, 'OKX', p.apr);

    const allAssets = Array.from(assetMap.keys());
    const symbols = allAssets.map(a => a + 'USDT');

    // 并行获取：资金费率 + OI + 市值数据（coinImage/coinName）
    const [fundingMap, oiMap, marketDataMap] = await Promise.all([
      withTimeout(batchGetFundingStats(allAssets), 55000, new Map()),
      withTimeout(getOpenInterestMap(allAssets), 55000, new Map()),
      withTimeout(getBatchMarketDataForSymbols(symbols), 15000, new Map()),
    ]);

    const rows: CombinedEarnRow[] = [];

    for (const [asset, exchMap] of assetMap.entries()) {
      const earnRates: EarnRate[] = Array.from(exchMap.entries())
        .map(([exchange, apr]) => ({ exchange, apr }))
        .sort((a, b) => b.apr - a.apr);

      const bestEarnApr = earnRates[0]?.apr || 0;
      const bestEarnExchange = earnRates[0]?.exchange || '';

      const fs = fundingMap.get(asset);
      const funding: FundingRate[] = [];
      if (fs) {
        if (fs.binance3d !== 0 || fs.binance7d !== 0) {
          funding.push({ exchange: 'Binance', apr3d: fs.binance3d, apr7d: fs.binance7d });
        }
        if (fs.bybit3d !== 0 || fs.bybit7d !== 0) {
          funding.push({ exchange: 'Bybit', apr3d: fs.bybit3d, apr7d: fs.bybit7d });
        }
      }

      let bestFunding3d = 0, bestFunding7d = 0;
      let bestFundingExchange3d = '', bestFundingExchange7d = '';
      if (funding.length > 0) {
        bestFunding3d = funding[0].apr3d;
        bestFundingExchange3d = funding[0].exchange;
        bestFunding7d = funding[0].apr7d;
        bestFundingExchange7d = funding[0].exchange;
        for (let i = 1; i < funding.length; i++) {
          if (funding[i].apr3d > bestFunding3d) {
            bestFunding3d = funding[i].apr3d;
            bestFundingExchange3d = funding[i].exchange;
          }
          if (funding[i].apr7d > bestFunding7d) {
            bestFunding7d = funding[i].apr7d;
            bestFundingExchange7d = funding[i].exchange;
          }
        }
      }

      const bestEarn3d = bestEarnApr;
      const bestEarn7d = bestEarnApr;

      const md = marketDataMap.get(asset + 'USDT');

      rows.push({
        asset,
        earnRates,
        bestEarnApr,
        bestEarnExchange,
        bestEarn3d,
        bestEarn7d,
        funding,
        bestFunding3d,
        bestFunding7d,
        bestFundingExchange3d,
        bestFundingExchange7d,
        combined3d: bestEarn3d + bestFunding3d,
        combined7d: bestEarn7d + bestFunding7d,
        coinImage: md?.image,
        coinName: md?.name,
        openInterest: oiMap.get(asset) ?? null,
      });
    }

    const withFunding = rows.filter(r => r.funding.length > 0).length;
    const fundingRatio = rows.length > 0 ? withFunding / rows.length : 1;
    if (fundingRatio > 0.80) {
      cachedEarn = { data: rows, timestamp: now };
      console.log('[earn] cached (' + withFunding + '/' + rows.length + ' have funding)');
    } else {
      console.log('[earn] NOT caching (' + withFunding + '/' + rows.length + ' have funding)');
    }

    return NextResponse.json({
      success: true,
      data: rows,
      timestamp: now,
      debug: {
        binance: binanceProducts.length,
        bybit: bybitProducts.length,
        okx: okxProducts.length,
      },
    });
  } catch (error) {
    console.error('获取活期理财数据失败:', error);
    return NextResponse.json(
      { success: false, error: '获取数据失败', data: [] },
      { status: 500 }
    );
  }
}
