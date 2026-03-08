import { NextResponse } from 'next/server';
import { getBinanceEarnProducts } from '@/lib/exchanges/binanceEarn';
import { getBybitEarnProducts } from '@/lib/exchanges/bybitEarn';
import { getOkxEarnProducts } from '@/lib/exchanges/okxEarn';
import { getBatchMarketDataForSymbols } from '@/lib/marketData';
import { batchGetFundingStats } from '@/lib/fundingAggregator';

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
  funding: FundingRate[];
  bestFunding3d: number;
  bestFunding7d: number;
  bestFundingExchange3d: string;
  bestFundingExchange7d: string;
  combined3d: number;
  combined7d: number;
  coinImage?: string;
  coinName?: string;
  marketCap: number | null;
}

// 进程级缓存
const CACHE_TTL_MS = 120 * 1000; // 120s（含资金费率历史，变化慢）
let cachedEarn: { data: CombinedEarnRow[]; timestamp: number } | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedEarn && now - cachedEarn.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(
        { success: true, data: cachedEarn.data, timestamp: cachedEarn.timestamp, cached: true },
        { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' } }
      );
    }

    // 并行获取三个交易所 earn 产品
    const [binanceProducts, bybitProducts, okxProducts] = await Promise.all([
      getBinanceEarnProducts(),
      getBybitEarnProducts(),
      getOkxEarnProducts(),
    ]);

    // 按 asset 聚合 earn rates
    const assetMap = new Map<string, EarnRate[]>();

    for (const p of binanceProducts) {
      const key = p.asset.toUpperCase();
      if (!assetMap.has(key)) assetMap.set(key, []);
      assetMap.get(key)!.push({ exchange: 'Binance', apr: p.apr });
    }
    for (const p of bybitProducts) {
      const key = p.asset.toUpperCase();
      if (!assetMap.has(key)) assetMap.set(key, []);
      assetMap.get(key)!.push({ exchange: 'Bybit', apr: p.apr });
    }
    for (const p of okxProducts) {
      const key = p.asset.toUpperCase();
      if (!assetMap.has(key)) assetMap.set(key, []);
      assetMap.get(key)!.push({ exchange: 'OKX', apr: p.apr });
    }

    const allAssets = Array.from(assetMap.keys());

    // 获取资金费率历史（只对有 earn 产品的 asset 查询）
    const fundingMap = await batchGetFundingStats(allAssets);

    // 获取市值数据
    const symbols = allAssets.map(a => a + 'USDT');
    const marketDataMap = await getBatchMarketDataForSymbols(symbols);

    // 构建 combined 行
    const rows: CombinedEarnRow[] = [];

    for (const [asset, earnRates] of assetMap.entries()) {
      // 最优 earn
      const sortedEarn = [...earnRates].sort((a, b) => b.apr - a.apr);
      const bestEarnApr = sortedEarn[0]?.apr || 0;
      const bestEarnExchange = sortedEarn[0]?.exchange || '';

      // 资金费率
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

      // 最优 funding
      let bestFunding3d = 0, bestFunding7d = 0;
      let bestFundingExchange3d = '', bestFundingExchange7d = '';
      for (const f of funding) {
        if (f.apr3d > bestFunding3d) {
          bestFunding3d = f.apr3d;
          bestFundingExchange3d = f.exchange;
        }
        if (f.apr7d > bestFunding7d) {
          bestFunding7d = f.apr7d;
          bestFundingExchange7d = f.exchange;
        }
      }

      // 市值
      const md = marketDataMap.get(asset + 'USDT');

      rows.push({
        asset,
        earnRates: sortedEarn,
        bestEarnApr,
        bestEarnExchange,
        funding,
        bestFunding3d,
        bestFunding7d,
        bestFundingExchange3d,
        bestFundingExchange7d,
        combined3d: bestEarnApr + bestFunding3d,
        combined7d: bestEarnApr + bestFunding7d,
        coinImage: md?.image,
        coinName: md?.name,
        marketCap: md?.marketCap ?? null,
      });
    }

    cachedEarn = { data: rows, timestamp: now };

    return NextResponse.json({
      success: true,
      data: rows,
      timestamp: now,
    });
  } catch (error) {
    console.error('获取活期理财数据失败:', error);
    return NextResponse.json(
      { success: false, error: '获取数据失败', data: [] },
      { status: 500 }
    );
  }
}
