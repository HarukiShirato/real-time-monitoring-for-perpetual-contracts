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
      return { asset: "LIT", apr, source: "lighter-staking", updatedAt: Date.now(), meta: { totalStaked: balance } };
    }
  } catch (e) {
    console.error(`[staking] LIT fetch failed: ${e.message}`);
  }
  return null;
}

async function fetchEthfiStaking() {
  try {
    // sETHFI contract: 0x86B5780b606940Eb59A062aA85a07959518c0161
    // ETHFI token: 0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb
    const RPC = 'https://eth.llamarpc.com';
    const headers = { 'Content-Type': 'application/json' };

    // Get ETHFI balance of sETHFI contract (totalAssets)
    const balRes = await axios.post(RPC, {
      jsonrpc: '2.0', method: 'eth_call', id: 1,
      params: [{ to: '0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb',
        data: '0x70a0823100000000000000000000000086B5780b606940Eb59A062aA85a07959518c0161' }, 'latest']
    }, { headers, timeout: 15000 });

    // Get sETHFI totalSupply
    const tsRes = await axios.post(RPC, {
      jsonrpc: '2.0', method: 'eth_call', id: 2,
      params: [{ to: '0x86B5780b606940Eb59A062aA85a07959518c0161',
        data: '0x18160ddd' }, 'latest']
    }, { headers, timeout: 15000 });

    const totalAssets = parseInt(balRes.data.result, 16) / 1e18;
    const totalSupply = parseInt(tsRes.data.result, 16) / 1e18;
    const rate = totalAssets / totalSupply;

    // Read previous rate to compute APR from rate change
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch {}
    const prev = existing.ETHFI_sethfi_rate;
    let apr = 0;

    if (prev && prev.rate > 0 && prev.time > 0) {
      const elapsed = (Date.now() - prev.time) / 1000; // seconds
      if (elapsed > 3600) { // need at least 1h of data
        const rateChange = rate / prev.rate - 1;
        apr = rateChange * (365.25 * 24 * 3600) / elapsed;
      }
    }

    // If no previous data or APR is unreasonable, estimate from launch (June 2024)
    if (apr <= 0 || apr > 1) {
      // Launched ~June 2024, rate started at 1.0
      const monthsSinceLaunch = (Date.now() - new Date('2024-06-01').getTime()) / (30.44 * 24 * 3600 * 1000);
      apr = (rate - 1) / monthsSinceLaunch * 12;
    }

    console.log(`[staking] ETHFI sETHFI rate: ${rate.toFixed(6)}, APR: ${(apr * 100).toFixed(2)}%, staked: ${(totalAssets / 1e6).toFixed(2)}M ETHFI`);

    return {
      asset: 'ETHFI',
      apr,
      source: 'sethfi-onchain',
      updatedAt: Date.now(),
      meta: { rate, totalStaked: totalAssets, unstakingDays: 10 },
    };
  } catch (e) {
    console.error('[staking] ETHFI fetch failed:', + e.message);
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

async function fetchMcapFallback(existingMcaps) {
  // For tokens not in Binance products, use CryptoCompare as fallback
  // CryptoCompare /data/pricemultifull supports up to ~50 symbols per call
  const allMissing = [];
  // We'll discover missing tokens later when the earn table requests them
  // For now, try a predefined list of commonly missing tokens
  const knownMissing = [
    'SKY','HYPE','SONIC','AERO','ATH','BLAST','BRETT','BTT','BTTC',
    'CORE','CRO','DEEP','DRIFT','ETHW','FLR','GOAT','GRASS','H','HNT',
    'IP','KAS','LIT','MERL','MEW','MNT','MOG','MON','MOODENG','NEIROCTO',
    'NIGHT','OKB','POPCAT','SAFE','SATS','SPX','STRAX','TAIKO',
    'TOMO','TOSHI','XAUT','XDC','ZETA','ZORA','BBSOL'
  ].filter(s => !existingMcaps[s]);

  if (knownMissing.length === 0) return existingMcaps;

  try {
    // CryptoCompare allows ~50 symbols per request
    const batchSize = 50;
    let filled = 0;
    for (let i = 0; i < knownMissing.length; i += batchSize) {
      const batch = knownMissing.slice(i, i + batchSize);
      const res = await axios.get("https://min-api.cryptocompare.com/data/pricemultifull", {
        params: { fsyms: batch.join(","), tsyms: "USD" },
        timeout: 15000,
      });
      const raw = res.data?.RAW || {};
      for (const [sym, currencies] of Object.entries(raw)) {
        const info = currencies.USD || {};
        const mcap = info.MKTCAP || 0;
        const price = info.PRICE || 0;
        const cs = info.CIRCULATINGSUPPLY || 0;
        if (mcap > 0) {
          existingMcaps[sym] = { mcap, price, cs, name: "" };
          filled++;
        }
      }
      if (i + batchSize < knownMissing.length) await sleep(500);
    }
    console.log("[staking] CryptoCompare fallback: filled " + filled + "/" + knownMissing.length + " missing tokens");
  } catch (e) {
    console.error("[staking] CryptoCompare fallback failed: " + e.message);
  }
  return existingMcaps;
}

async function fetchBinanceOI() {
  const result = {};
  try {
    // Get all symbols + prices from premiumIndex
    const res = await axios.get("https://www.binance.com/fapi/v1/premiumIndex", { timeout: 15000 });
    const symbols = res.data.filter(i => i.symbol.endsWith("USDT"));
    const priceMap = {};
    for (const s of symbols) priceMap[s.symbol] = parseFloat(s.markPrice || "0");

    let ok = 0;
    for (const s of symbols) {
      try {
        const oiRes = await axios.get("https://www.binance.com/fapi/v1/openInterest", {
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

  const results = await Promise.all([fetchSkyStaking(), fetchHypeStaking(), fetchLitStaking(), fetchEthfiStaking()]);
  
  for (const r of results) {
    if (r) {
      const entry = { apr: r.apr, source: r.source, updatedAt: r.updatedAt };
      if (r.meta) entry.meta = r.meta;
      existing[r.asset] = entry;
    }
  }
  

  // Save sETHFI rate for APR tracking
  const ethfiResult = results.find(r => r && r.asset === 'ETHFI');
  if (ethfiResult && ethfiResult.meta) {
    existing.ETHFI_sethfi_rate = { rate: ethfiResult.meta.rate, time: Date.now() };
  }

  // Fetch Market Caps
  const marketCaps = await fetchMarketCaps();
  const mcapsWithFallback = await fetchMcapFallback(marketCaps);
  if (Object.keys(mcapsWithFallback).length > 0) {
    existing.marketCaps = mcapsWithFallback;
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
