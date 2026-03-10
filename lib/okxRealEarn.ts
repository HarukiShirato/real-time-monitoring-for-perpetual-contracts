import crypto from 'crypto';
import axios from 'axios';

/**
 * 从 OKX dennis 账户获取真实 Simple Earn 借贷历史
 * 计算每个币种的 3d / 7d 平均真实年化收益率
 */

export interface OkxRealRate {
  apr3d: number;   // 3天平均真实年化
  apr7d: number;   // 7天平均真实年化
  latest: number;  // 最新一期利率
}

const OKX_BASE = 'https://www.okx.com';
const CACHE_TTL = 60 * 60 * 1000; // 1 小时缓存（lending history 约每小时更新一次）

interface CacheEntry {
  data: Map<string, OkxRealRate>;
  timestamp: number;
}

function getCache(): CacheEntry | null {
  const g = globalThis as any;
  return g.__okxRealEarnCache ?? null;
}
function setCache(entry: CacheEntry) {
  (globalThis as any).__okxRealEarnCache = entry;
}

/** OKX 签名 */
function sign(timestamp: string, method: string, requestPath: string, secret: string): string {
  const prehash = timestamp + method + requestPath;
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/(\.\d{3})\d*Z/, '$1Z');
}

interface LendingRecord {
  ccy: string;
  rate: string;   // 年化利率（如 0.25 = 25%）
  amt: string;
  earnings: string;
  ts: string;
}

async function fetchLendingHistory(): Promise<LendingRecord[]> {
  const apiKey = process.env.OKX_API_KEY;
  const secret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    console.error('[okxReal] Missing OKX credentials in env');
    return [];
  }

  const allRecords: LendingRecord[] = [];
  let afterTs = '';

  // 取 7 页 × 100 条 = 700 条，覆盖约 10 天（每币种每小时一条）
  for (let page = 0; page < 7; page++) {
    const path = '/api/v5/finance/savings/lending-history';
    let queryStr = 'limit=100';
    if (afterTs) queryStr += `&after=${afterTs}`;
    const fullPath = path + '?' + queryStr;

    const ts = getTimestamp();
    const signature = sign(ts, 'GET', fullPath, secret);

    try {
      const resp = await axios.get(OKX_BASE + fullPath, {
        headers: {
          'OK-ACCESS-KEY': apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': ts,
          'OK-ACCESS-PASSPHRASE': passphrase,
        },
        timeout: 10000,
      });

      const records: LendingRecord[] = resp.data?.data ?? [];
      if (records.length === 0) break;

      allRecords.push(...records);
      afterTs = records[records.length - 1].ts;

      // 如果最老的记录已经超过 8 天，够用了
      const oldestAge = Date.now() - parseInt(afterTs);
      if (oldestAge > 8 * 24 * 60 * 60 * 1000) break;
    } catch (e: any) {
      console.error(`[okxReal] fetch page ${page} failed: ${e.message}`);
      break;
    }
  }

  console.log(`[okxReal] fetched ${allRecords.length} lending records`);
  return allRecords;
}

function calcAvgRate(records: LendingRecord[], ccy: string, days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const relevant = records.filter(r => r.ccy === ccy && parseInt(r.ts) >= cutoff);
  if (relevant.length === 0) return 0;
  const sum = relevant.reduce((s, r) => s + parseFloat(r.rate), 0);
  return sum / relevant.length;
}

/**
 * 获取 OKX dennis 真实收益率
 * 返回 Map<ASSET, OkxRealRate>
 */
export async function getOkxRealEarnRates(): Promise<Map<string, OkxRealRate>> {
  const cached = getCache();
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[okxReal] using cache (${cached.data.size} assets)`);
    return cached.data;
  }

  const records = await fetchLendingHistory();
  if (records.length === 0) return new Map();

  // 收集所有币种
  const currencies = new Set(records.map(r => r.ccy));
  const result = new Map<string, OkxRealRate>();

  for (const ccy of currencies) {
    const apr3d = calcAvgRate(records, ccy, 3);
    const apr7d = calcAvgRate(records, ccy, 7);
    const ccyRecords = records.filter(r => r.ccy === ccy);
    const latest = ccyRecords.length > 0 ? parseFloat(ccyRecords[0].rate) : 0;

    result.set(ccy.toUpperCase(), { apr3d, apr7d, latest });
  }

  console.log(`[okxReal] computed rates for ${result.size} assets:`,
    [...result.entries()].map(([k, v]) => `${k}(3d=${(v.apr3d*100).toFixed(1)}%,7d=${(v.apr7d*100).toFixed(1)}%)`).join(', '));

  setCache({ data: result, timestamp: Date.now() });
  return result;
}
