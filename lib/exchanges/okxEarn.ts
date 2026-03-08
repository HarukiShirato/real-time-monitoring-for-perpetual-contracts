import axios from 'axios';

export interface OkxEarnProduct {
  asset: string;
  apr: number;
  minAmount: number;
  maxAmount: number | null;
}

const OKX_API_BASE = 'https://www.okx.com';

/**
 * 获取 OKX Simple Earn 借贷利率
 * GET /api/v5/finance/savings/lending-rate-summary
 */
export async function getOkxEarnProducts(): Promise<OkxEarnProduct[]> {
  const results: OkxEarnProduct[] = [];

  try {
    const response = await axios.get(
      `${OKX_API_BASE}/api/v5/finance/savings/lending-rate-summary`,
      { timeout: 15000 }
    );

    if (response.data?.code !== '0') {
      console.error('OKX Earn API error:', response.data?.msg);
      return results;
    }

    const list = response.data?.data;
    if (!Array.isArray(list)) return results;

    for (const item of list) {
      // avgApr 是平均年化利率（小数形式）
      const apr = parseFloat(item.avgRate || item.avgApr || '0');
      if (apr <= 0) continue;

      results.push({
        asset: (item.ccy || '').toUpperCase(),
        apr,
        minAmount: parseFloat(item.minLend || '0'),
        maxAmount: item.maxLend ? parseFloat(item.maxLend) : null,
      });
    }
  } catch (error) {
    console.error('获取 OKX Simple Earn 利率失败:', error);
  }

  return results;
}
