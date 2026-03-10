import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "staking-rewards.json");
const FILE_CACHE_TTL = 60 * 1000; // re-read file every 60s

let cache: { data: Map<string, number>; ts: number } | null = null;

/**
 * Read native staking reward rates from data/staking-rewards.json
 * (written by scripts/staking-collector.js every 8 hours)
 * Returns Map<asset, apr> where apr is decimal (e.g. 0.1074 = 10.74%)
 */
export async function getStakingRewardsMap(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.ts < FILE_CACHE_TTL) return cache.data;

  const result = new Map<string, number>();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      for (const [key, val] of Object.entries(raw)) {
        if (key === "collectedAt") continue;
        const entry = val as { apr: number; source: string; updatedAt: number };
        if (entry.apr > 0) {
          result.set(key, entry.apr);
        }
      }
      console.log(`[staking] Loaded ${result.size} staking rates from file`);
    }
  } catch (e: any) {
    console.error(`[staking] Failed to read staking data: ${e.message}`);
  }

  cache = { data: result, ts: Date.now() };
  return result;
}


export interface FileMcap {
  mcap: number;
  price: number;
  cs: number;
  name: string;
}

export async function getMarketCapsFromFile(): Promise<Map<string, FileMcap>> {
  const map = new Map<string, FileMcap>();
  try {
    const raw = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) : null;
    if (raw && raw.marketCaps) {
      for (const [symbol, data] of Object.entries(raw.marketCaps)) {
        const d = data as any;
        if (d && d.mcap > 0) {
          map.set(symbol, { mcap: d.mcap, price: d.price, cs: d.cs, name: d.name || "" });
        }
      }
    }
  } catch (e) {
    console.error("[stakingRewards] Failed to read market caps:", e);
  }
  return map;
}
