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
  bestEarn3d: number;       // OKX 历史 3 天平均 earn APR
  bestEarn7d: number;       // OKX 历史 7 天平均 earn APR
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

    // 按 asset 聚合 earn rates（同交易所去重，取最高 APR）
    // 过滤掉衍生资产（如 BETH 是 Binance 的质押 ETH，ETH 已覆盖）
    const EXCLUDED_ASSETS = new Set(['BETH']);
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

    // 并行获取：资金费率历史 + 市值数据
    const symbols = allAssets.map(a => a + 'USDT');
    const [fundingMap, marketDataMap] = await Promise.all([
      batchGetFundingStats(allAssets),
      getBatchMarketDataForSymbols(symbols),
    ]);

    // 构建 combined 行
    const rows: CombinedEarnRow[] = [];

    for (const [asset, exchMap] of assetMap.entries()) {
      // 转换为 EarnRate[]，按 APR 降序
      const earnRates: EarnRate[] = Array.from(exchMap.entries())
        .map(([exchange, apr]) => ({ exchange, apr }))
        .sort((a, b) => b.apr - a.apr);

      const bestEarnApr = earnRates[0]?.apr || 0;
      const bestEarnExchange = earnRates[0]?.exchange || '';

      // 资金费率（负值也保留，只过滤 0 即"无合约"的情况）
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

      // 最优 funding（负值也参与选择，选最高的；无数据时为 0）
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

      // 活期利率：统一用当前时点 APR（各交易所均无公开历史接口）
      const bestEarn3d = bestEarnApr;
      const bestEarn7d = bestEarnApr;

      // 市值
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
