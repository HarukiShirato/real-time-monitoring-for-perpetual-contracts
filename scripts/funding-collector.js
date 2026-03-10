#!/usr/bin/env node
/**
 * 资金费率采集器 v3 - 简化版
 * 每小时采集一次，慢慢取，不触发 rate limit
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'funding-history.json');
const MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

const BINANCE_FAPI = 'https://fapi.binance.com';
const BYBIT_API = 'https://api.bybit.com';

/* ── Store ── */
let store = { binance: {}, bybit: {}, updatedAt: 0 };

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      store.binance = saved.binance || {};
      store.bybit = saved.bybit || {};
      store.updatedAt = saved.updatedAt || 0;
      console.log(`[collector] Loaded: bn=${Object.keys(store.binance).length}, by=${Object.keys(store.bybit).length}`);
    }
  } catch (e) {
    console.error('[collector] Load failed:', e.message);
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    store.updatedAt = Date.now();
    fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  } catch (e) {
    console.error('[collector] Save failed:', e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Binance: 获取所有 USDT 合约 symbol ── */
async function getBinanceSymbols() {
  const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { timeout: 15000 });
  return res.data.filter(item => item.symbol.endsWith('USDT')).map(item => item.symbol);
}

/* ── Binance: 逐个获取结算历史，每个间隔200ms ── */
async function collectBinance() {
  let symbols;
  try {
    symbols = await getBinanceSymbols();
  } catch (e) {
    console.error('[collector] Binance symbols failed:', e.message);
    return;
  }

  let success = 0, fail = 0;
  for (const symbol of symbols) {
    try {
      const startTime = Date.now() - MAX_AGE_MS;
      const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/fundingRate`, {
        params: { symbol, startTime, limit: 100 },
        timeout: 10000,
      });
      const rates = (res.data || []).map(item => ({
        time: parseInt(item.fundingTime),
        rate: parseFloat(item.fundingRate || '0'),
      }));
      if (rates.length > 0) {
        store.binance[symbol] = rates;
        success++;
      }

    } catch {
      fail++;
    }
    await sleep(200); // 每个请求间隔 200ms，不触发 rate limit
  }
  console.log(`[collector] Binance: ${success} ok, ${fail} fail (${symbols.length} total)`);
}

/* ── Bybit: 获取 instruments + funding history ── */
async function collectBybit() {
  let symbolsData;
  try {
    const res = await axios.get(`${BYBIT_API}/v5/market/instruments-info`, {
      params: { category: 'linear', limit: 1000 },
      timeout: 15000,
    });
    symbolsData = (res.data?.result?.list || [])
      .filter(item => item.status === 'Trading' && item.symbol.endsWith('USDT'))
      .map(item => ({
        symbol: item.symbol,
        intervalHours: parseInt(item.fundingInterval || '480') / 60,
      }));
  } catch (e) {
    console.error('[collector] Bybit instruments failed:', e.message);
    return;
  }

  let success = 0, fail = 0;
  for (const { symbol, intervalHours } of symbolsData) {
    try {
      const res = await axios.get(`${BYBIT_API}/v5/market/funding/history`, {
        params: { category: 'linear', symbol, limit: 50 },
        timeout: 10000,
      });
      const rates = (res.data?.result?.list || []).map(item => ({
        time: parseInt(item.fundingRateTimestamp),
        rate: parseFloat(item.fundingRate || '0'),
      }));
      if (rates.length > 0) {
        store.bybit[symbol] = { intervalHours, rates };
        success++;
      }
    } catch {
      fail++;
    }
    await sleep(200);
  }
  console.log(`[collector] Bybit: ${success} ok, ${fail} fail (${symbolsData.length} total)`);
}

/* ── 采集一轮 ── */
async function collectAll() {
  const start = Date.now();
  console.log(`[collector] Starting collection at ${new Date().toISOString()}`);

  await Promise.all([collectBinance(), collectBybit()]);
  saveStore();

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[collector] Done in ${elapsed}s. bn=${Object.keys(store.binance).length}, by=${Object.keys(store.bybit).length}`);
}

/* ── 主循环 ── */
async function run() {
  console.log('[collector] Starting funding collector v3');
  loadStore();

  // 立即采集一次
  await collectAll();

  // 每小时采集一次
  setInterval(async () => {
    try { await collectAll(); } catch (e) { console.error('[collector] Error:', e.message); }
  }, 60 * 60 * 1000);
}

run().catch(e => { console.error('[collector] Fatal:', e); process.exit(1); });
