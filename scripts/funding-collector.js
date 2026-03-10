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

const BINANCE_FAPI = 'https://www.binance.com';  // www proxy avoids 403 on fapi.binance.com
const BYBIT_API = 'https://api.bybit.com';

/* ── Store ── */
let store = { binance: {}, bybit: {}, hyperliquid: {}, updatedAt: 0 };

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      store.binance = saved.binance || {};
      store.bybit = saved.bybit || {};
      store.hyperliquid = saved.hyperliquid || {};
      store.updatedAt = saved.updatedAt || 0;
      console.log(`[collector] Loaded: bn=${Object.keys(store.binance).length}, by=${Object.keys(store.bybit).length}, hl=${Object.keys(store.hyperliquid).length}`);
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

/* ── Binance: 检测结算间隔 ── */
let binanceIntervals = {}; // symbol -> interval in hours (1, 4, 8)
let binanceRunCount = 0;   // 记录第几次运行

function detectInterval(rates) {
  if (!rates || rates.length < 3) return 8;
  const diffs = [];
  for (let i = 1; i < Math.min(rates.length, 6); i++) {
    diffs.push((rates[i].time - rates[i - 1].time) / 3600000);
  }
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  if (median <= 1.5) return 1;
  if (median <= 6) return 4;
  return 8;
}

/* ── Binance: 按结算间隔分组采集 ── */
async function collectBinance() {
  let allSymbols;
  try {
    allSymbols = await getBinanceSymbols();
  } catch (e) {
    console.error('[collector] Binance symbols failed:', e.message);
    return;
  }

  const hour = new Date().getUTCHours();
  binanceRunCount++;

  // 首次运行或没有间隔数据：全量采集
  const hasIntervals = Object.keys(binanceIntervals).length > 0;
  let symbols;
  if (!hasIntervals) {
    symbols = allSymbols;
    console.log('[collector] Binance: full fetch (initial, ' + allSymbols.length + ' symbols)');
  } else {
    // 按间隔过滤需要采集的币种
    symbols = allSymbols.filter(sym => {
      const interval = binanceIntervals[sym] || 8;
      if (interval === 1) return true;            // 1h: 每次都采
      if (interval === 4) return hour % 4 === 0;  // 4h: 每4小时
      return hour % 8 === 0;                       // 8h: 每8小时
    });
    const counts = { '1h': 0, '4h': 0, '8h': 0 };
    for (const sym of symbols) {
      const iv = binanceIntervals[sym] || 8;
      if (iv === 1) counts['1h']++;
      else if (iv === 4) counts['4h']++;
      else counts['8h']++;
    }
    console.log('[collector] Binance: ' + symbols.length + '/' + allSymbols.length + ' symbols this run (1h:' + counts['1h'] + ' 4h:' + counts['4h'] + ' 8h:' + counts['8h'] + ') hour=' + hour);
  }

  let success = 0, fail = 0;
  for (const symbol of symbols) {
    try {
      const startTime = Date.now() - MAX_AGE_MS;
      const interval = binanceIntervals[symbol] || 8;
      // 1h币种需要更多条目覆盖7天 (168条)
      const limit = interval === 1 ? 200 : 100;
      const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/fundingRate`, {
        params: { symbol, startTime, limit },
        timeout: 10000,
      });
      const rates = (res.data || []).map(item => ({
        time: parseInt(item.fundingTime),
        rate: parseFloat(item.fundingRate || '0'),
      }));
      if (rates.length > 0) {
        store.binance[symbol] = rates;
        // 检测并缓存间隔
        const detected = detectInterval(rates);
        binanceIntervals[symbol] = detected;
        success++;
      }
    } catch {
      fail++;
    }
    await sleep(1800);
  }
  console.log('[collector] Binance: ' + success + ' ok, ' + fail + ' fail (' + symbols.length + ' due)');
}

/* ── Bybit: 按结算间隔分组采集 ── */
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

  const hour = new Date().getUTCHours();

  // 首次运行或定时采集
  const hasBybitData = Object.keys(store.bybit).length > 0;
  let due;
  if (!hasBybitData) {
    due = symbolsData;
    console.log('[collector] Bybit: full fetch (initial, ' + symbolsData.length + ' symbols)');
  } else {
    due = symbolsData.filter(({ intervalHours }) => {
      if (intervalHours <= 1) return true;           // 1h: 每次
      if (intervalHours <= 4) return hour % 4 === 0; // 4h: 每4小时
      return hour % 8 === 0;                          // 8h: 每8小时
    });
    const counts = { '1h': 0, '4h': 0, '8h': 0 };
    for (const { intervalHours } of due) {
      if (intervalHours <= 1) counts['1h']++;
      else if (intervalHours <= 4) counts['4h']++;
      else counts['8h']++;
    }
    console.log('[collector] Bybit: ' + due.length + '/' + symbolsData.length + ' symbols this run (1h:' + counts['1h'] + ' 4h:' + counts['4h'] + ' 8h:' + counts['8h'] + ') hour=' + hour);
  }

  let success = 0, fail = 0;
  for (const { symbol, intervalHours } of due) {
    try {
      const limit = intervalHours <= 1 ? 200 : 50;
      const res = await axios.get(`${BYBIT_API}/v5/market/funding/history`, {
        params: { category: 'linear', symbol, limit },
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
    await sleep(1200);
  }
  console.log('[collector] Bybit: ' + success + ' ok, ' + fail + ' fail (' + due.length + ' due)');
}


/* ── Hyperliquid: 获取主流永续合约资金费率历史 (过滤HIP-3) ── */
async function collectHyperliquid() {
  let coins;
  try {
    const metaRes = await axios.post('https://api.hyperliquid.xyz/info',
      { type: 'meta' },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    // Only keep non-delisted tokens with maxLeverage > 3 (filters out HIP-3)
    coins = metaRes.data.universe
      .filter(m => !m.isDelisted && m.maxLeverage > 3)
      .map(m => m.name);
  } catch (e) {
    console.error('[collector] Hyperliquid meta failed:', e.message);
    return;
  }

  const startTime = Date.now() - MAX_AGE_MS;
  let success = 0, fail = 0;
  for (const coin of coins) {
    try {
      const res = await axios.post('https://api.hyperliquid.xyz/info',
        { type: 'fundingHistory', coin, startTime },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      const rates = (res.data || []).map(item => ({
        time: item.time,
        rate: parseFloat(item.fundingRate || '0'),
      }));
      if (rates.length > 0) {
        // Handle k-prefix: kPEPE -> PEPEUSDT, kSHIB -> SHIBUSDT etc.
        let symbol = coin;
        if (coin.startsWith('k') && coin.length > 1 && coin[1] === coin[1].toUpperCase()) {
          symbol = coin.substring(1);
        }
        store.hyperliquid[symbol + 'USDT'] = rates;
        success++;
      }
    } catch {
      fail++;
    }
    await sleep(200); // 0.2s per request for Hyperliquid (no rate limits)
  }
  console.log('[collector] Hyperliquid: ' + success + ' ok, ' + fail + ' fail (' + coins.length + ' total)');
}

/* ── 采集一轮 ── */
async function collectAll() {
  const start = Date.now();
  console.log(`[collector] Starting collection at ${new Date().toISOString()}`);

  await Promise.all([collectBinance(), collectBybit(), collectHyperliquid()]);
  saveStore();

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[collector] Done in ${elapsed}s. bn=${Object.keys(store.binance).length}, by=${Object.keys(store.bybit).length}, hl=${Object.keys(store.hyperliquid).length}`);
}

/* ── 主循环 ── */
async function run() {
  console.log('[collector] Starting funding collector v3');
  loadStore();

  // 从已有数据初始化 Binance 结算间隔
  for (const [sym, rates] of Object.entries(store.binance)) {
    if (Array.isArray(rates) && rates.length >= 3) {
      binanceIntervals[sym] = detectInterval(rates);
    }
  }
  const ivCounts = { 1: 0, 4: 0, 8: 0 };
  for (const iv of Object.values(binanceIntervals)) ivCounts[iv] = (ivCounts[iv] || 0) + 1;
  console.log('[collector] Binance intervals from cache: 1h=' + (ivCounts[1]||0) + ' 4h=' + (ivCounts[4]||0) + ' 8h=' + (ivCounts[8]||0));

  // 立即采集一次
  await collectAll();

  // 每小时采集一次
  setInterval(async () => {
    try { await collectAll(); } catch (e) { console.error('[collector] Error:', e.message); }
  }, 60 * 60 * 1000);
}

run().catch(e => { console.error('[collector] Fatal:', e); process.exit(1); });
