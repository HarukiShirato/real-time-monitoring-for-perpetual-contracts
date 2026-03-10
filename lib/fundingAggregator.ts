import axios from 'axios';

/**
 * 使用批量 API 获取 Binance/Bybit 资金费率（仅 2 次 API 调用）
 * 在内存中逐步积累历史数据，计算 3d/7d 平均年化
 *
 * Binance: GET /fapi/v1/premiumIndex (返回全部合约)
 * Bybit:   GET /v5/market/tickers?category=linear (返回全部合约)
 */

export interface FundingStats {
  binance3d: number;
  binance7d: number;
  bybit3d: number;
  bybit7d: number;
}

const BINANCE_FAPI = 'https://fapi.binance.com';
const BYBIT_API = 'https://api.bybit.com';

// ── 数据缓存（globalThis 跨模块持久化） ──
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000; // 快照缓存 5 分钟（premiumIndex 调用很轻量）
const HISTORY_MAX_AGE = 8 * 24 * 60 * 60 * 1000; // 保留 8 天历史

interface RateSnapshot {
  binance: Map<string, number>;  // symbol → lastFundingRate
  bybit: Map<string, number>;
  timestamp: number;
}

interface HistoryEntry {
  time: number;
  rate: number;
}

interface FundingStore {
  snapshot: RateSnapshot | null;
  // 累积历史：key = "bn:BTCUSDT" or "by:BTCUSDT"
  history: Map<string, HistoryEntry[]>;
}

function getStore(): FundingStore {
  const g = globalThis as any;
  if (!g.__fundingStore) {
    g.__fundingStore = {
      snapshot: null,
      history: new Map(),
    } as FundingStore;
  }
  return g.__fundingStore;
}

/**
 * 从 Binance premiumIndex 获取全部合约的当前资金费率（1 次请求）
 */
async function fetchBinanceRates(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { timeout: 15000 });
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        const rate = parseFloat(item.lastFundingRate || '0');
        map.set(item.symbol, rate);
      }
    }
    console.log(`[funding] Binance premiumIndex: ${map.size} symbols`);
  } catch (e: any) {
    console.error(`[funding] Binance premiumIndex failed: ${e.message}`);
  }
  return map;
}

/**
 * 从 Bybit tickers 获取全部合约的当前资金费率（1 次请求）
 */
async function fetchBybitRates(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await axios.get(`${BYBIT_API}/v5/market/tickers`, {
      params: { category: 'linear' },
      timeout: 15000,
    });
    const list = res.data?.result?.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        const rate = parseFloat(item.fundingRate || '0');
        map.set(item.symbol, rate);
      }
    }
    console.log(`[funding] Bybit tickers: ${map.size} symbols`);
  } catch (e: any) {
    console.error(`[funding] Bybit tickers failed: ${e.message}`);
  }
  return map;
}

/**
 * 获取最新快照（带 5 分钟缓存）
 */
async function getLatestSnapshot(): Promise<RateSnapshot> {
  const store = getStore();

  if (store.snapshot && Date.now() - store.snapshot.timestamp < SNAPSHOT_CACHE_TTL) {
    return store.snapshot;
  }

  // 并行获取两个交易所（共 2 次 API 调用）
  const [binance, bybit] = await Promise.all([
    fetchBinanceRates(),
    fetchBybitRates(),
  ]);

  const snapshot: RateSnapshot = { binance, bybit, timestamp: Date.now() };
  store.snapshot = snapshot;

  // 将最新费率写入历史
  const now = Date.now();
  for (const [symbol, rate] of binance) {
    appendHistory(`bn:${symbol}`, now, rate);
  }
  for (const [symbol, rate] of bybit) {
    appendHistory(`by:${symbol}`, now, rate);
  }

  return snapshot;
}

/**
 * 追加历史数据点（去重 + 清理过期数据）
 */
function appendHistory(key: string, time: number, rate: number): void {
  const store = getStore();
  let arr = store.history.get(key);
  if (!arr) {
    arr = [];
    store.history.set(key, arr);
  }

  // 去重：同一个 5 分钟窗口内不重复添加
  const lastTime = arr.length > 0 ? arr[arr.length - 1].time : 0;
  if (time - lastTime < 4 * 60 * 1000) return; // 4 分钟内不重复

  arr.push({ time, rate });

  // 清理超过 8 天的旧数据
  const cutoff = Date.now() - HISTORY_MAX_AGE;
  while (arr.length > 0 && arr[0].time < cutoff) {
    arr.shift();
  }
}

/**
 * 从累积历史中计算 N 天平均年化 APR
 * 如果历史不足，则使用已有数据（最少 1 个点）
 */
function calcAvgAprFromHistory(key: string, days: number): number {
  const store = getStore();
  const arr = store.history.get(key);
  if (!arr || arr.length === 0) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = arr.filter(r => r.time >= cutoff);
  if (recent.length === 0) return 0;

  const avgRate = recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;

  // 推断结算间隔（默认 8 小时）
  let intervalHours = 8;
  if (recent.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(recent.length, 5); i++) {
      intervals.push(Math.abs(recent[i].time - recent[i - 1].time));
    }
    const avgIntervalMs = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    // 由于我们每 5 分钟采样一次，但实际结算是 4h/8h
    // 使用 8h 作为默认（除非所有数据点之间正好隔 4h）
    const inferred = Math.round(avgIntervalMs / (1000 * 60 * 60));
    if (inferred >= 3 && inferred <= 24) intervalHours = inferred;
    // 但我们的采样频率是 5 分钟，不能用来推断结算间隔
    // 所以固定 8 小时
    intervalHours = 8;
  }

  return avgRate * (24 / intervalHours) * 365;
}

// 1000x 前缀映射
const EXCHANGE_1000X_ASSETS = new Set([
  'PEPE', 'BONK', 'SHIB', 'FLOKI', 'LUNC', 'SATS', 'RATS', 'CAT',
  'CHEEMS', 'MOGCOIN', 'WHY', 'X', 'APU',
]);

/**
 * 批量获取多个 asset 的资金费率统计
 * 只需 2 次 API 调用（Binance premiumIndex + Bybit tickers）
 */
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

    // 如果有累积历史（>1 个点），用历史计算平均值
    // 否则用最新快照的单点费率年化
    const bnHistory = store.history.get(bnKey);
    const byHistory = store.history.get(byKey);

    let binance3d: number, binance7d: number;
    let bybit3d: number, bybit7d: number;

    if (bnHistory && bnHistory.length > 1) {
      binance3d = calcAvgAprFromHistory(bnKey, 3);
      binance7d = calcAvgAprFromHistory(bnKey, 7);
    } else {
      // 单点：直接年化
      const rate = snapshot.binance.get(bnSymbol) ?? 0;
      const apr = rate * 3 * 365; // 8h 结算 → 每天 3 次
      binance3d = apr;
      binance7d = apr;
    }

    if (byHistory && byHistory.length > 1) {
      bybit3d = calcAvgAprFromHistory(byKey, 3);
      bybit7d = calcAvgAprFromHistory(byKey, 7);
    } else {
      const rate = snapshot.bybit.get(bySymbol) ?? 0;
      const apr = rate * 3 * 365;
      bybit3d = apr;
      bybit7d = apr;
    }

    result.set(upper, { binance3d, binance7d, bybit3d, bybit7d });
  }

  const withData = [...result.values()].filter(s => s.binance3d !== 0 || s.bybit3d !== 0).length;
  console.log(`[funding] ${withData}/${result.size} have data (history points: ${store.history.size})`);

  return result;
}
