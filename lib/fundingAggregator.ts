import axios from 'axios';
import fs from 'fs';
import path from 'path';

/**
 * 资金费率聚合器 v5
 * - 从 data/funding-history.json 读取后台采集器持续记录的费率数据
 * - Binance + Bybit 都从文件读取实际结算历史
 * - 正确处理 Bybit 不同结算间隔 (1h/4h/8h)
 * - 仍保留 bulk snapshot 用于 OI 数据
 */

export interface FundingStats {
  binance3d: number;
  binance7d: number;
  bybit3d: number;
  bybit7d: number;
  hyperliquid3d: number;
  hyperliquid7d: number;
}

const BINANCE_FAPI = 'https://www.binance.com';  // www proxy avoids 403
const BYBIT_API = 'https://api.bybit.com';
const DATA_FILE = path.join(process.cwd(), 'data', 'funding-history.json');

/* ── Types ── */
interface SettledRate { time: number; rate: number; }

interface FundingHistoryData {
  binance: Record<string, SettledRate[]>;
  bybit: Record<string, { intervalHours: number; rates: SettledRate[] }>;
  hyperliquid: Record<string, SettledRate[]>;
  updatedAt: number;
}

/* ── Snapshot for OI ── */
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000;
interface RateSnapshot {
  binance: Map<string, number>;
  bybit: Map<string, number>;
  hyperliquid: Map<string, number>;
  binanceOI: Map<string, number>;
  bybitOI: Map<string, number>;
  hyperliquidOI: Map<string, number>;
  timestamp: number;
}

/* ── File data cache ── */
const FILE_CACHE_TTL = 60 * 1000; // 每分钟重新读取文件

interface Store {
  snapshot: RateSnapshot | null;
  fileData: FundingHistoryData | null;
  fileDataTs: number;
}

function getStore(): Store {
  const g = globalThis as any;
  if (!g.__fundingStore5) {
    g.__fundingStore5 = { snapshot: null, fileData: null, fileDataTs: 0 } as Store;
  }
  return g.__fundingStore5;
}

/* ── 读取采集器数据文件 ── */
function getFundingHistory(): FundingHistoryData | null {
  const store = getStore();
  if (store.fileData && Date.now() - store.fileDataTs < FILE_CACHE_TTL) {
    return store.fileData;
  }
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log('[funding] data file not found:', DATA_FILE);
      return null;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw) as FundingHistoryData;
    store.fileData = data;
    store.fileDataTs = Date.now();
    return data;
  } catch (e: any) {
    console.error('[funding] Failed to read data file:', e.message);
    return null;
  }
}

/* ── Bulk snapshot: Binance ── */
async function fetchBinanceData(): Promise<{ rates: Map<string, number>; oi: Map<string, number> }> {
  const rates = new Map<string, number>();
  const oi = new Map<string, number>();
  try {
    const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { timeout: 15000 });
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        rates.set(item.symbol, parseFloat(item.lastFundingRate || '0'));
      }
    }
    console.log(`[funding] Binance premiumIndex: ${rates.size} symbols`);
  } catch (e: any) {
    console.error(`[funding] Binance premiumIndex failed: ${e.message}`);
  }
  return { rates, oi };
}

/* ── Bulk snapshot: Bybit ── */
async function fetchBybitData(): Promise<{ rates: Map<string, number>; oi: Map<string, number> }> {
  const rates = new Map<string, number>();
  const oi = new Map<string, number>();
  try {
    const res = await axios.get(`${BYBIT_API}/v5/market/tickers`, {
      params: { category: 'linear' },
      timeout: 15000,
    });
    const list = res.data?.result?.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        rates.set(item.symbol, parseFloat(item.fundingRate || '0'));
        const oiValue = parseFloat(item.openInterestValue || '0');
        if (oiValue > 0) oi.set(item.symbol, oiValue);
      }
    }
    console.log(`[funding] Bybit tickers: ${rates.size} symbols, ${oi.size} with OI`);
  } catch (e: any) {
    console.error(`[funding] Bybit tickers failed: ${e.message}`);
  }
  return { rates, oi };
}


/* ── Bulk snapshot: Hyperliquid ── */
async function fetchHyperliquidData(): Promise<{ rates: Map<string, number>; oi: Map<string, number> }> {
  const rates = new Map<string, number>();
  const oi = new Map<string, number>();
  try {
    const res = await axios.post('https://api.hyperliquid.xyz/info',
      { type: 'metaAndAssetCtxs' },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const meta = res.data[0];
    const ctxs = res.data[1];
    for (let i = 0; i < meta.universe.length; i++) {
      const m = meta.universe[i];
      if (m.isDelisted || m.maxLeverage <= 3) continue; // Skip HIP-3
      const coin = m.name;
      const ctx = ctxs[i];
      // Handle k-prefix: kPEPE -> PEPEUSDT
      let base = coin;
      if (coin.startsWith('k') && coin.length > 1 && coin[1] === coin[1].toUpperCase()) {
        base = coin.substring(1);
      }
      const symbol = base + 'USDT';
      rates.set(symbol, parseFloat(ctx.funding || '0'));
      const oiVal = parseFloat(ctx.openInterest || '0');
      const markPx = parseFloat(ctx.markPx || '0');
      if (oiVal > 0 && markPx > 0) oi.set(symbol, oiVal * markPx);
    }
    console.log(`[funding] Hyperliquid: ${rates.size} symbols, ${oi.size} with OI`);
  } catch (e: any) {
    console.error(`[funding] Hyperliquid fetch failed: ${e.message}`);
  }
  return { rates, oi };
}

async function getLatestSnapshot(): Promise<RateSnapshot> {
  const store = getStore();
  if (store.snapshot && Date.now() - store.snapshot.timestamp < SNAPSHOT_CACHE_TTL) {
    return store.snapshot;
  }
  const [binanceData, bybitData, hlData] = await Promise.all([
    fetchBinanceData(),
    fetchBybitData(),
    fetchHyperliquidData(),
  ]);
  const snapshot: RateSnapshot = {
    binance: binanceData.rates,
    bybit: bybitData.rates,
    hyperliquid: hlData.rates,
    binanceOI: binanceData.oi,
    bybitOI: bybitData.oi,
    hyperliquidOI: hlData.oi,
    timestamp: Date.now(),
  };
  store.snapshot = snapshot;
  return snapshot;
}


/* ── 从数据时间戳自动检测结算间隔 ── */
function detectIntervalHours(rates: SettledRate[]): number {
  if (rates.length < 2) return 8;
  // Use median of first few intervals to be robust
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(rates.length, 6); i++) {
    intervals.push((rates[i].time - rates[i - 1].time) / 3600000);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  // Round to nearest standard interval: 1, 2, 4, 8
  if (median <= 1.5) return 1;
  if (median <= 3) return 2;
  if (median <= 6) return 4;
  return 8;
}

/* ── 从结算数据计算年化 ── */
function calcAprFromSettled(rates: SettledRate[], days: number, intervalHours: number): number {
  if (rates.length === 0) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = rates.filter(r => r.time >= cutoff);
  if (recent.length === 0) return 0;
  const avgRate = recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;
  const settlementsPerDay = 24 / intervalHours;
  return avgRate * settlementsPerDay * 365;
}

const EXCHANGE_1000X_ASSETS = new Set([
  'PEPE', 'BONK', 'SHIB', 'FLOKI', 'LUNC', 'SATS', 'RATS', 'CAT',
  'CHEEMS', 'MOGCOIN', 'WHY', 'X', 'APU',
]);

/** 批量获取资金费率 */
export async function batchGetFundingStats(assets: string[]): Promise<Map<string, FundingStats>> {
  const snapshot = await getLatestSnapshot();
  const histData = getFundingHistory();
  const result = new Map<string, FundingStats>();

  for (const a of assets) {
    const upper = a.toUpperCase();
    const is1000x = EXCHANGE_1000X_ASSETS.has(upper);
    const bnSymbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;
    const bySymbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;

    // Binance: 从文件读取实际结算历史
    let binance3d = 0, binance7d = 0;
    const bnHist = histData?.binance?.[bnSymbol];
    if (bnHist && bnHist.length > 0) {
      const bnInterval = detectIntervalHours(bnHist);
      binance3d = calcAprFromSettled(bnHist, 3, bnInterval);
      binance7d = calcAprFromSettled(bnHist, 7, bnInterval);
    }

    // Bybit: 从文件读取实际结算历史
    let bybit3d = 0, bybit7d = 0;
    const byData = histData?.bybit?.[bySymbol];
    if (byData && byData.rates && byData.rates.length > 0) {
      const intervalH = byData.intervalHours || 8;
      bybit3d = calcAprFromSettled(byData.rates, 3, intervalH);
      bybit7d = calcAprFromSettled(byData.rates, 7, intervalH);
    }

    // Hyperliquid: 从文件读取，1h结算间隔
    let hyperliquid3d = 0, hyperliquid7d = 0;
    const hlHist = histData?.hyperliquid?.[upper + 'USDT'];
    if (hlHist && hlHist.length > 0) {
      hyperliquid3d = calcAprFromSettled(hlHist, 3, 1);
      hyperliquid7d = calcAprFromSettled(hlHist, 7, 1);
    }

    result.set(upper, { binance3d, binance7d, bybit3d, bybit7d, hyperliquid3d, hyperliquid7d });
  }

  const withData = [...result.values()].filter(s =>
    s.binance3d !== 0 || s.binance7d !== 0 || s.bybit3d !== 0 || s.bybit7d !== 0
  ).length;
  const bnSymCount = histData ? Object.keys(histData.binance || {}).length : 0;
  const bySymCount = histData ? Object.keys(histData.bybit || {}).length : 0;
  const age = histData ? Math.round((Date.now() - (histData.updatedAt || 0)) / 1000) : -1;
  const hlSymCount = histData ? Object.keys(histData.hyperliquid || {}).length : 0;
  console.log(`[funding] ${withData}/${result.size} have data (file: bn=${bnSymCount} by=${bySymCount} hl=${hlSymCount}, age=${age}s)`);
  return result;
}

export interface ExchangeOI {
  binance: number;
  bybit: number;
  hyperliquid: number;
}

/**
 * 获取各交易所 OI 数据（USDT 计价）
 */
export async function getOpenInterestMap(assets: string[]): Promise<Map<string, ExchangeOI>> {
  const snapshot = await getLatestSnapshot();
  const result = new Map<string, ExchangeOI>();

  // Read Binance OI from staking-rewards.json (collected every 8h)
  let fileBinanceOI: Record<string, number> = {};
  try {
    const stakingFile = path.join(process.cwd(), 'data', 'staking-rewards.json');
    if (fs.existsSync(stakingFile)) {
      const raw = JSON.parse(fs.readFileSync(stakingFile, 'utf-8'));
      fileBinanceOI = raw.binanceOI || {};
    }
  } catch {}

  for (const a of assets) {
    const upper = a.toUpperCase();
    const is1000x = EXCHANGE_1000X_ASSETS.has(upper);
    const symbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;
    const binanceOI = fileBinanceOI[symbol] ?? snapshot.binanceOI.get(symbol) ?? 0;
    const bybitOI = snapshot.bybitOI.get(symbol) ?? 0;
    const hlOI = snapshot.hyperliquidOI.get(symbol) ?? 0;
    if (binanceOI > 0 || bybitOI > 0 || hlOI > 0) {
      result.set(upper, { binance: binanceOI, bybit: bybitOI, hyperliquid: hlOI });
    }
  }

  return result;
}
