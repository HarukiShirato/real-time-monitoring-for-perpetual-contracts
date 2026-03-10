/**
 * Staking Rewards Collector
 * Fetches native staking rates for SKY and HYPE every 8 hours
 * Writes to data/staking-rewards.json
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "staking-rewards.json");

async function fetchSkyStaking() {
  try {
    const res = await axios.get("https://info-sky.blockanalitica.com/api/v1/overall/", { timeout: 10000 });
    const overall = Array.isArray(res.data) ? res.data[0] : res.data;
    const apr = parseFloat(overall?.sky_sky_apy || "0");
    if (apr > 0) {
      console.log(`[staking] SKY native staking APY: ${(apr * 100).toFixed(2)}%`);
      return { asset: "SKY", apr, source: "sky-protocol", updatedAt: Date.now() };
    }
  } catch (e) {
    console.error(`[staking] SKY fetch failed: ${e.message}`);
  }
  return null;
}

async function fetchHypeStaking() {
  try {
    const res = await axios.post("https://api.hyperliquid.xyz/info", 
      { type: "validatorSummaries" },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    if (Array.isArray(res.data) && res.data.length > 0) {
      // Get average APR across active validators (use "month" stats for stability)
      const activeValidators = res.data.filter(v => v.isActive && !v.isJailed);
      let totalApr = 0;
      let count = 0;
      for (const v of activeValidators) {
        const monthStats = v.stats?.find(s => s[0] === "month");
        if (monthStats) {
          const apr = parseFloat(monthStats[1].predictedApr || "0");
          if (apr > 0) {
            totalApr += apr;
            count++;
          }
        }
      }
      if (count > 0) {
        const avgApr = totalApr / count;
        console.log(`[staking] HYPE avg staking APR: ${(avgApr * 100).toFixed(2)}% (${count} active validators)`);
        return { asset: "HYPE", apr: avgApr, source: "hyperliquid-validators", updatedAt: Date.now() };
      }
    }
  } catch (e) {
    console.error(`[staking] HYPE fetch failed: ${e.message}`);
  }
  return null;
}

async function fetchLitStaking() {
  try {
    const res = await axios.get("https://mainnet.zklighter.elliot.ai/api/v1/account", {
      params: { by: "index", value: "281474976624800" },
      timeout: 10000,
    });
    const balance = parseFloat(res.data?.accounts?.[0]?.assets?.[0]?.balance || "0");
    if (balance > 0) {
      const apr = 1e7 / balance; // 10M annual reward / totalStaked
      console.log(`[staking] LIT staking APR: ${(apr * 100).toFixed(2)}% (staked: ${(balance / 1e6).toFixed(2)}M LIT)`);
      return { asset: "LIT", apr, source: "lighter-staking", updatedAt: Date.now() };
    }
  } catch (e) {
    console.error(`[staking] LIT fetch failed: ${e.message}`);
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


async function fetchMarketCaps() {
  const result = {};
  try {
    const res = await axios.get("https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products", {
      params: { includeEtf: true },
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity", "Accept": "application/json" },
      timeout: 15000,
    });
    const items = res.data?.data || [];
    let count = 0;
    for (const item of items) {
      if (!item.s || !item.s.endsWith("USDT")) continue;
      const cs = parseFloat(item.cs || "0");
      const price = parseFloat(item.c || "0");
      if (cs > 0 && price > 0) {
        const base = item.b || item.s.replace("USDT", "");
        result[base] = { mcap: cs * price, price, cs, name: item.an || "" };
        count++;
      }
    }
    console.log("[staking] Market caps: " + count + " tokens from Binance");
  } catch (e) {
    console.error("[staking] Market caps fetch failed: " + e.message);
  }
  return result;
}

async function fetchBinanceOI() {
  const result = {};
  try {
    // Get all symbols + prices from premiumIndex
    const res = await axios.get("https://fapi.binance.com/fapi/v1/premiumIndex", { timeout: 15000 });
    const symbols = res.data.filter(i => i.symbol.endsWith("USDT"));
    const priceMap = {};
    for (const s of symbols) priceMap[s.symbol] = parseFloat(s.markPrice || "0");

    let ok = 0;
    for (const s of symbols) {
      try {
        const oiRes = await axios.get("https://fapi.binance.com/fapi/v1/openInterest", {
          params: { symbol: s.symbol }, timeout: 5000,
        });
        const qty = parseFloat(oiRes.data?.openInterest || "0");
        const price = priceMap[s.symbol] || 0;
        if (qty > 0 && price > 0) {
          result[s.symbol] = qty * price;
          ok++;
        }
      } catch {}
      await sleep(200);
    }
    console.log("[staking] Binance OI: " + ok + " symbols collected");
  } catch (e) {
    console.error("[staking] Binance OI fetch failed: " + e.message);
  }
  return result;
}

async function collect() {
  console.log(`[staking] Starting collection at ${new Date().toISOString()}`);
  
  // Read existing data
  let existing = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (e) {
    console.error(`[staking] Failed to read existing data: ${e.message}`);
  }

  const results = await Promise.all([fetchSkyStaking(), fetchHypeStaking(), fetchLitStaking()]);
  
  for (const r of results) {
    if (r) {
      existing[r.asset] = { apr: r.apr, source: r.source, updatedAt: r.updatedAt };
    }
  }
  
  // Fetch Market Caps
  const marketCaps = await fetchMarketCaps();
  if (Object.keys(marketCaps).length > 0) {
    existing.marketCaps = marketCaps;
  }

  // Fetch Binance OI
  const binanceOI = await fetchBinanceOI();
  if (Object.keys(binanceOI).length > 0) {
    existing.binanceOI = binanceOI;
  }

  existing.collectedAt = Date.now();
  
  // Ensure data dir exists
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
  console.log(`[staking] Saved to ${DATA_FILE}`);
}

// Run immediately on start
collect().then(() => {
  console.log("[staking] Initial collection done");
});

// Then every 8 hours
setInterval(() => {
  collect().catch(e => console.error("[staking] Collection error:", e.message));
}, 8 * 60 * 60 * 1000);

console.log("[staking] Collector started, interval: 8 hours");
