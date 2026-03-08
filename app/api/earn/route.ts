import { NextResponse } from 'next/server';
import { getBinanceEarnProducts } from '@/lib/exchanges/binanceEarn';
import { getBybitEarnProducts } from '@/lib/exchanges/bybitEarn';
import { getOkxEarnProducts } from '@/lib/exchanges/okxEarn';
import { getBatchMarketDataForSymbols } from '@/lib/marketData';

export interface EarnProduct {
  asset: string;
  exchange: 'Binance' | 'Bybit' | 'OKX';
  apr: number;
  minAmount: number;
  maxAmount: number | null;
  coinImage?: string;
  coinName?: string;
  marketCap: number | null;
}

// 进程级缓存
const CACHE_TTL_MS = 60 * 1000; // 60s
let cachedEarn: { data: EarnProduct[]; timestamp: number } | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedEarn && now - cachedEarn.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(
        { success: true, data: cachedEarn.data, timestamp: cachedEarn.timestamp, cached: true },
        { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } }
      );
    }

    // 并行获取三个交易所数据
    const [binanceProducts, bybitProducts, okxProducts] = await Promise.all([
      getBinanceEarnProducts(),
      getBybitEarnProducts(),
      getOkxEarnProducts(),
    ]);

    const allProducts: EarnProduct[] = [];
    const allAssets: string[] = [];

    // Binance
    for (const p of binanceProducts) {
      const sym = p.asset + 'USDT';
      allAssets.push(sym);
      allProducts.push({
        asset: p.asset,
        exchange: 'Binance',
        apr: p.apr,
        minAmount: p.minPurchaseAmount,
        maxAmount: p.maxPurchaseAmount,
        marketCap: null,
      });
    }

    // Bybit
    for (const p of bybitProducts) {
      const sym = p.asset + 'USDT';
      allAssets.push(sym);
      allProducts.push({
        asset: p.asset,
        exchange: 'Bybit',
        apr: p.apr,
        minAmount: p.minStakeAmount,
        maxAmount: p.maxStakeAmount,
        marketCap: null,
      });
    }

    // OKX
    for (const p of okxProducts) {
      const sym = p.asset + 'USDT';
      allAssets.push(sym);
      allProducts.push({
        asset: p.asset,
        exchange: 'OKX',
        apr: p.apr,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
        marketCap: null,
      });
    }

    // 批量获取市值数据
    const uniqueSymbols = [...new Set(allAssets)];
    const marketDataMap = await getBatchMarketDataForSymbols(uniqueSymbols);

    // 填充市值和图标
    for (const product of allProducts) {
      const sym = product.asset + 'USDT';
      const md = marketDataMap.get(sym);
      if (md) {
        product.marketCap = md.marketCap;
        product.coinImage = md.image;
        product.coinName = md.name;
      }
    }

    cachedEarn = { data: allProducts, timestamp: now };

    return NextResponse.json({
      success: true,
      data: allProducts,
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
