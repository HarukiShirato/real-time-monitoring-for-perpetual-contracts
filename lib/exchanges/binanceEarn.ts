import axios from 'axios';

export interface BinanceEarnProduct {
  asset: string;
  apr: number;
  minPurchaseAmount: number;
  maxPurchaseAmount: number | null;
  canPurchase: boolean;
}

/**
 * 获取 Binance Simple Earn 活期产品列表
 * 使用 Binance 网站公开 API（无需签名）
 */
export async function getBinanceEarnProducts(): Promise<BinanceEarnProduct[]> {
  const results: BinanceEarnProduct[] = [];
  let current = 1;
  const pageSize = 200;

  try {
    while (true) {
      const response = await axios.post(
        'https://www.binance.com/bapi/earn/v2/friendly/finance/product/list',
        {
          asset: '',
          current,
          size: pageSize,
          type: 'ACTIVITY',
          status: 'SUBSCRIBABLE',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );

      const rows = response.data?.data?.list;
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const item of rows) {
        // latestAnnualPercentageRate / avgAnnualPercentageRate
        const apr = parseFloat(
          item.latestAnnualPercentageRate ||
          item.avgAnnualPercentageRate ||
          item.annualPercentageRate ||
          '0'
        );
        if (apr <= 0) continue;

        results.push({
          asset: item.asset || item.productName || '',
          apr,
          minPurchaseAmount: parseFloat(item.minPurchaseAmount || '0'),
          maxPurchaseAmount: item.maxPurchaseAmountPerUser
            ? parseFloat(item.maxPurchaseAmountPerUser)
            : null,
          canPurchase: item.canPurchase !== false,
        });
      }

      const total = response.data?.data?.total || 0;
      if (current * pageSize >= total) break;
      current++;

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error: any) {
    // 如果 bapi 失败，尝试备用公开 API
    console.error('Binance bapi 失败，尝试备用方案:', error?.message);
    try {
      return await getBinanceEarnProductsFallback();
    } catch (fallbackErr) {
      console.error('Binance 备用方案也失败:', fallbackErr);
    }
  }

  return results;
}

/**
 * 备用方案：使用 Binance 另一个公开接口
 */
async function getBinanceEarnProductsFallback(): Promise<BinanceEarnProduct[]> {
  const results: BinanceEarnProduct[] = [];

  const response = await axios.get(
    'https://www.binance.com/bapi/earn/v1/friendly/lending/daily/token/listAll',
    { timeout: 15000 }
  );

  const list = response.data?.data;
  if (!Array.isArray(list)) return results;

  for (const item of list) {
    const apr = parseFloat(item.dailyInterestRate || '0') * 365;
    if (apr <= 0) continue;

    results.push({
      asset: item.asset || '',
      apr,
      minPurchaseAmount: parseFloat(item.minPurchaseAmount || '0'),
      maxPurchaseAmount: item.maxPurchaseAmount
        ? parseFloat(item.maxPurchaseAmount)
        : null,
      canPurchase: true,
    });
  }

  return results;
}
