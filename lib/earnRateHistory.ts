import axios from 'axios';

/**
 * 获取交易所历史活期借贷利率，计算 3d/7d 平均年化
 * OKX: GET /api/v5/finance/savings/lending-rate-history (公开接口)
 */

export interface EarnRateStats {
  okx3d: number;   // 年化 APR（小数）
  okx7d: number;
}

const OKX_API_BASE = 'https://www.okx.com';

/**
 * 获取 OKX 某个币种的历史借贷利率
 * GET /api/v5/finance/savings/lending-rate-history?ccy=BTC
 */
async function getOkxLendingRateHistory(ccy: string): Promise<{ time: number; rate: number }[]> {
  try {
    const response = await axios.get(
      `${OKX_API_BASE}/api/v5/finance/savings/lending-rate-history`,
      {
        params: { ccy },
        timeout: 10000,
      }
    );

    if (response.data?.code !== '0') return [];

    const list = response.data?.data;
    if (!Array.isArray(list)) return [];

    return list.map((item: any) => ({
      time: Number(item.ts),
      rate: parseFloat(item.rate || '0'),
    }));
  } catch {
    return [];
  }
}

/**
 * 从利率记录中计算 N 天内的平均年化 APR
 */
function calcAvgApr(records: { time: number; rate: number }[], days: number): number {
  if (records.length === 0) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = records.filter(r => r.time >= cutoff);
  if (recent.length === 0) return 0;

  const avgRate = recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;

  // OKX lending rate 是每日利率（小数），年化 = dailyRate * 365
  // 如果返回的是每小时利率，需要 * 24 * 365
  // 根据 OKX 文档，rate 是借贷利率（日利率形式）
  return avgRate * 365;
}

/**
 * 批量获取多个 asset 的历史活期利率统计
 * @param assets - 基础币种列表，如 ['BTC', 'ETH', 'SOL']
 * @returns Map<asset, EarnRateStats>
 */
export async function batchGetEarnRateHistory(assets: string[]): Promise<Map<string, EarnRateStats>> {
  const result = new Map<string, EarnRateStats>();

  // 批量请求，每批 10 个，避免限流
  const batchSize = 10;
  const delay = 200;

  for (let i = 0; i < assets.length; i += batchSize) {
    const batch = assets.slice(i, i + batchSize);

    const promises = batch.map(async (asset) => {
      const ccy = asset.toUpperCase();
      const okxHistory = await getOkxLendingRateHistory(ccy);

      const stats: EarnRateStats = {
        okx3d: calcAvgApr(okxHistory, 3),
        okx7d: calcAvgApr(okxHistory, 7),
      };

      return { asset: ccy, stats };
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ asset, stats }) => {
      result.set(asset, stats);
    });

    if (i + batchSize < assets.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return result;
}
