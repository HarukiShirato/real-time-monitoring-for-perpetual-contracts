import axios from 'axios';

/**
 * 批量获取 Binance/Bybit 历史资金费率，计算 3d/7d 平均年化
 */

export interface FundingStats {
  binance3d: number;  // 年化 APR（小数）
  binance7d: number;
  bybit3d: number;
  bybit7d: number;
}

const BINANCE_FAPI = 'https://fapi.binance.com';
const BYBIT_API = 'https://api.bybit.com';

/**
 * 获取 Binance 某个 symbol 的历史资金费率
 */
async function getBinanceFundingHistory(symbol: string): Promise<{ time: number; rate: number }[]> {
  try {
    const response = await axios.get(`${BINANCE_FAPI}/fapi/v1/fundingRate`, {
      params: { symbol, limit: 100 },
      timeout: 10000,
    });
    if (!Array.isArray(response.data)) return [];
    return response.data.map((item: any) => ({
      time: Number(item.fundingTime),
      rate: parseFloat(item.fundingRate || '0'),
    }));
  } catch {
    return [];
  }
}

/**
 * 获取 Bybit 某个 symbol 的历史资金费率
 */
async function getBybitFundingHistory(symbol: string): Promise<{ time: number; rate: number }[]> {
  try {
    const response = await axios.get(`${BYBIT_API}/v5/market/funding/history`, {
      params: { category: 'linear', symbol, limit: 100 },
      timeout: 10000,
    });
    const list = response.data?.result?.list;
    if (!Array.isArray(list)) return [];
    // Bybit 返回最新在前，需要反转
    return list.reverse().map((item: any) => ({
      time: Number(item.fundingRateTimestamp),
      rate: parseFloat(item.fundingRate || '0'),
    }));
  } catch {
    return [];
  }
}

/**
 * 从资金费率记录中计算 N 天内的平均年化 APR
 */
function calcAvgApr(records: { time: number; rate: number }[], days: number): number {
  if (records.length === 0) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = records.filter(r => r.time >= cutoff);
  if (recent.length === 0) return 0;

  const avgRate = recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;

  // 推断结算间隔
  let intervalHours = 8; // 默认
  if (recent.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(recent.length, 5); i++) {
      intervals.push(Math.abs(recent[i].time - recent[i - 1].time));
    }
    const avgIntervalMs = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const inferred = Math.round(avgIntervalMs / (1000 * 60 * 60));
    if (inferred >= 1 && inferred <= 24) intervalHours = inferred;
  }

  const cyclesPerDay = 24 / intervalHours;
  return avgRate * cyclesPerDay * 365;
}

/**
 * 批量获取多个 asset 的资金费率统计
 * @param assets - 基础币种列表，如 ['BTC', 'ETH', 'SOL']
 * @returns Map<asset, FundingStats>
 */
export async function batchGetFundingStats(assets: string[]): Promise<Map<string, FundingStats>> {
  const result = new Map<string, FundingStats>();
  const symbols = assets.map(a => a.toUpperCase() + 'USDT');

  // 批量请求，每批 10 个，避免限流
  const batchSize = 10;
  const delay = 200;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);

    const promises = batch.map(async (symbol) => {
      const asset = symbol.replace('USDT', '');
      const [binanceHistory, bybitHistory] = await Promise.all([
        getBinanceFundingHistory(symbol),
        getBybitFundingHistory(symbol),
      ]);

      const stats: FundingStats = {
        binance3d: calcAvgApr(binanceHistory, 3),
        binance7d: calcAvgApr(binanceHistory, 7),
        bybit3d: calcAvgApr(bybitHistory, 3),
        bybit7d: calcAvgApr(bybitHistory, 7),
      };

      return { asset, stats };
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ asset, stats }) => {
      result.set(asset, stats);
    });

    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return result;
}
