import axios from 'axios';

export interface BybitEarnProduct {
  asset: string;
  apr: number;
  minStakeAmount: number;
  maxStakeAmount: number | null;
}

/**
 * 获取 Bybit Savings 活期产品列表
 * 优先使用公开 Web API，回退到 v5 API
 */
export async function getBybitEarnProducts(): Promise<BybitEarnProduct[]> {
  // 尝试公开 Web API（Bybit 网站使用）
  try {
    return await getBybitEarnFromWebApi();
  } catch (err: any) {
    console.error('Bybit Web API 失败:', err?.message);
  }

  // 回退到 v5 API
  try {
    return await getBybitEarnFromV5Api();
  } catch (err: any) {
    console.error('Bybit v5 Earn API 也失败:', err?.message);
  }

  return [];
}

async function getBybitEarnFromWebApi(): Promise<BybitEarnProduct[]> {
  const results: BybitEarnProduct[] = [];

  const response = await axios.post(
    'https://api2.bybit.com/s3/earn/stable/product/list',
    { category: 'FlexibleSaving', pageSize: 200, page: 1 },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );

  const list = response.data?.result?.list || response.data?.data?.list || response.data?.result || [];
  if (!Array.isArray(list)) return results;

  for (const item of list) {
    let apr = parseFloat(
      item.estimateApr || item.apr || item.annualYield || item.flexibleAnnualYield || '0'
    );
    if (apr <= 0) continue;
    // Bybit Web API 返回百分比数值（如 25.3 表示 25.3%），转为小数
    if (apr > 1) apr = apr / 100;

    results.push({
      asset: (item.coin || item.tokenName || item.currency || '').toUpperCase(),
      apr,
      minStakeAmount: parseFloat(item.minStakeAmount || item.minAmount || '0'),
      maxStakeAmount: item.maxStakeAmount
        ? parseFloat(item.maxStakeAmount)
        : null,
    });
  }

  return results;
}

async function getBybitEarnFromV5Api(): Promise<BybitEarnProduct[]> {
  const results: BybitEarnProduct[] = [];
  let cursor = '';

  while (true) {
    const params: Record<string, string> = { category: 'FlexibleSaving' };
    if (cursor) params.cursor = cursor;

    const response = await axios.get('https://api.bybit.com/v5/earn/product', {
      params,
      timeout: 15000,
    });

    if (response.data?.retCode !== 0) break;

    const list = response.data?.result?.list;
    if (!Array.isArray(list) || list.length === 0) break;

    for (const item of list) {
      let apr = parseFloat(item.estimateApr || item.flexibleAnnualYield || '0');
      if (apr <= 0) continue;
      // Bybit 返回百分比数值，转为小数
      if (apr > 1) apr = apr / 100;

      results.push({
        asset: (item.coin || item.tokenName || '').toUpperCase(),
        apr,
        minStakeAmount: parseFloat(item.minStakeAmount || '0'),
        maxStakeAmount: item.maxStakeAmount ? parseFloat(item.maxStakeAmount) : null,
      });
    }

    cursor = response.data?.result?.nextPageCursor || '';
    if (!cursor) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return results;
}
