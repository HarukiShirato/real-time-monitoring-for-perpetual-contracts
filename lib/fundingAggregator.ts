import axios from 'axios';

/**
 * 使用批量 API 获取 Binance/Bybit 资金费率 + OI（仅 2 次 API 调用）
 * 在内存中逐步积累历史数据，计算 3d/7d 平均年化
 */

export interface FundingStats {
  binance3d: number;
  binance7d: number;
  bybit3d: number;
  bybit7d: number;
}

const BINANCE_FAPI = 'https://fapi.binance.com';
const BYBIT_API = 'https://api.bybit.com';

const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000;
const HISTORY_MAX_AGE = 8 * 24 * 60 * 60 * 1000;

interface RateSnapshot {
  binance: Map<string, number>;
  bybit: Map<string, number>;
  // OI (USDT 计价)
  binanceOI: Map<string, number>;
  bybitOI: Map<string, number>;
  timestamp: number;
}

interface HistoryEntry { time: number; rate: number; }

interface FundingStore {
  snapshot: RateSnapshot | null;
  history: Map<string, HistoryEntry[]>;
}

function getStore(): FundingStore {
  const g = globalThis as any;
  if (!g.__fundingStore) {
    g.__fundingStore = { snapshot: null, history: new Map() } as FundingStore;
  }
  return g.__fundingStore;
}

/** Binance premiumIndex: 全部合约的费率 + markPrice（用于 OI 换算） */
async function fetchBinanceData(): Promise<{ rates: Map<string, number>; oi: Map<string, number> }> {
  const rates = new Map<string, number>();
  const oi = new Map<string, number>();
  try {
    // premiumIndex 获取费率和 markPrice
    const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { timeout: 15000 });
    const markPrices = new Map<string, number>();
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        rates.set(item.symbol, parseFloat(item.lastFundingRate || '0'));
        markPrices.set(item.symbol, parseFloat(item.markPrice || '0'));
      }
    }
    // ticker/24hr 获取 volume (base asset)，结合 markPrice 估算 OI 替代方案
    // 但实际上 Binance 没有批量 OI 接口，所以我们只用 Bybit OI
    console.log(`[funding] Binance premiumIndex: ${rates.size} symbols`);
  } catch (e: any) {
    console.error(`[funding] Binance premiumIndex failed: ${e.message}`);
  }
  return { rates, oi };
}

/** Bybit tickers: 全部合约的费率 + OI（USDT 计价） */
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

async function getLatestSnapshot(): Promise<RateSnapshot> {
  const store = getStore();
  if (store.snapshot && Date.now() - store.snapshot.timestamp < SNAPSHOT_CACHE_TTL) {
    return store.snapshot;
  }

  const [binanceData, bybitData] = await Promise.all([
    fetchBinanceData(),
    fetchBybitData(),
  ]);

  const snapshot: RateSnapshot = {
    binance: binanceData.rates,
    bybit: bybitData.rates,
    binanceOI: binanceData.oi,
    bybitOI: bybitData.oi,
    timestamp: Date.now(),
  };
  store.snapshot = snapshot;

  const now = Date.now();
  for (const [symbol, rate] of binanceData.rates) appendHistory(`bn:${symbol}`, now, rate);
  for (const [symbol, rate] of bybitData.rates) appendHistory(`by:${symbol}`, now, rate);

  return snapshot;
}

function appendHistory(key: string, time: number, rate: number): void {
  const store = getStore();
  let arr = store.history.get(key);
  if (!arr) { arr = []; store.history.set(key, arr); }
  const lastTime = arr.length > 0 ? arr[arr.length - 1].time : 0;
  if (time - lastTime < 4 * 60 * 1000) return;
  arr.push({ time, rate });
  const cutoff = Date.now() - HISTORY_MAX_AGE;
  while (arr.length > 0 && arr[0].time < cutoff) arr.shift();
}

function calcAvgAprFromHistory(key: string, days: number): number {
  const store = getStore();
  const arr = store.history.get(key);
  if (!arr || arr.length === 0) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = arr.filter(r => r.time >= cutoff);
  if (recent.length === 0) return 0;
  const avgRate = recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;
  return avgRate * 3 * 365; // 8h 结算 → 每天 3 次
}

const EXCHANGE_1000X_ASSETS = new Set([
  'PEPE', 'BONK', 'SHIB', 'FLOKI', 'LUNC', 'SATS', 'RATS', 'CAT',
  'CHEEMS', 'MOGCOIN', 'WHY', 'X', 'APU',
]);

/** 批量获取资金费率（2 次 API 调用） */
export async function batchGetFundingStats(assets: string[]): Promise<Map<string, FundingStats>> {
  const snapshot = await getLatestSnapshot();
  const store = getStore();
  const result = new Map<string, FundingStats>();

  for (const a of assets) {
    const upper = a.toUpperCase();
    const is1000x = EXCHANGE_1000X_ASSETS.has(upper);
    const bnSymbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;
    const bySymbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;
    const bnKey = `bn:${bnSymbol}`;
    const byKey = `by:${bySymbol}`;

    const bnHistory = store.history.get(bnKey);
    const byHistory = store.history.get(byKey);

    let binance3d: number, binance7d: number, bybit3d: number, bybit7d: number;

    if (bnHistory && bnHistory.length > 1) {
      binance3d = calcAvgAprFromHistory(bnKey, 3);
      binance7d = calcAvgAprFromHistory(bnKey, 7);
    } else {
      const apr = (snapshot.binance.get(bnSymbol) ?? 0) * 3 * 365;
      binance3d = apr; binance7d = apr;
    }

    if (byHistory && byHistory.length > 1) {
      bybit3d = calcAvgAprFromHistory(byKey, 3);
      bybit7d = calcAvgAprFromHistory(byKey, 7);
    } else {
      const apr = (snapshot.bybit.get(bySymbol) ?? 0) * 3 * 365;
      bybit3d = apr; bybit7d = apr;
    }

    result.set(upper, { binance3d, binance7d, bybit3d, bybit7d });
  }

  const withData = [...result.values()].filter(s => s.binance3d !== 0 || s.bybit3d !== 0).length;
  console.log(`[funding] ${withData}/${result.size} have data`);
  return result;
}

/**
 * 获取 OI 数据（USDT 计价）
 * 使用 Bybit openInterestValue（已在 tickers 中包含）
 */
export async function getOpenInterestMap(assets: string[]): Promise<Map<string, number>> {
  const snapshot = await getLatestSnapshot();
  const result = new Map<string, number>();

  for (const a of assets) {
    const upper = a.toUpperCase();
    const is1000x = EXCHANGE_1000X_ASSETS.has(upper);
    const symbol = is1000x ? `1000${upper}USDT` : `${upper}USDT`;

    // 合并 Bybit + Binance OI（取较大值，因为两个交易所都有流动性）
    const bybitOI = snapshot.bybitOI.get(symbol) ?? 0;
    // Binance OI 暂时不可用（无批量接口），后续可扩展
    const totalOI = bybitOI;

    if (totalOI > 0) result.set(upper, totalOI);
  }

  return result;
}
