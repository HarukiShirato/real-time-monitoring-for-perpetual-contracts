import axios from "axios";

const SKY_API = "https://info-sky.blockanalitica.com/api/v1/overall/";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let cache: { data: Map<string, number>; ts: number } | null = null;

/**
 * Fetch native staking reward rates from protocol APIs.
 * Currently supports SKY only.
 * Returns Map<asset, apr> where apr is decimal (e.g. 0.1074 = 10.74%)
 */
export async function getStakingRewardsMap(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const result = new Map<string, number>();
  try {
    const res = await axios.get(SKY_API, { timeout: 10000 });
    const overall = Array.isArray(res.data) ? res.data[0] : res.data;
    const skyApy = parseFloat(overall?.sky_sky_apy || "0");
    if (skyApy > 0) {
      result.set("SKY", skyApy);
      console.log(`[staking] SKY native staking APY: ${(skyApy * 100).toFixed(2)}%`);
    }
  } catch (e: any) {
    console.error(`[staking] Failed to fetch SKY staking rate: ${e.message}`);
  }

  cache = { data: result, ts: Date.now() };
  return result;
}
