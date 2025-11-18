import axios from 'axios';

/**
 * Binance 永续合约数据接口
 * 
 * 数据字段说明：
 * - OI (Open Interest): 未平仓合约数量，单位为张数（contracts）
 * - Insurance Fund: 保险基金余额，单位为 USDT
 */

export interface BinancePerpData {
  symbol: string; // 合约符号，如 BTCUSDT
  markPrice: number; // 标记价格
  lastPrice: number; // 最新成交价
  openInterest: number; // 未平仓量（张数）
  openInterestValue: number; // 未平仓名义价值（USDT）
  insuranceFund: number; // 保险基金余额（USDT）
}

const BINANCE_API_BASE = 'https://fapi.binance.com';

/**
 * 获取 Binance 永续合约列表
 */
async function getBinanceSymbols(): Promise<string[]> {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/fapi/v1/exchangeInfo`);
    return response.data.symbols
      .filter((s: any) => 
        s.contractType === 'PERPETUAL' && 
        s.status === 'TRADING' &&
        s.symbol.endsWith('USDT') // 只保留USDT交易对
      )
      .map((s: any) => s.symbol);
  } catch (error) {
    console.error('获取 Binance 合约列表失败:', error);
    return [];
  }
}

/**
 * 获取 Binance 标记价格
 */
async function getBinanceMarkPrices(): Promise<Map<string, number>> {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/fapi/v1/premiumIndex`);
    const prices = new Map<string, number>();
    response.data.forEach((item: any) => {
      prices.set(item.symbol, parseFloat(item.markPrice));
    });
    return prices;
  } catch (error) {
    console.error('获取 Binance 标记价格失败:', error);
    return new Map();
  }
}

/**
 * 获取 Binance 最新成交价
 */
async function getBinanceLastPrices(): Promise<Map<string, number>> {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/fapi/v1/ticker/24hr`);
    const prices = new Map<string, number>();
    response.data.forEach((item: any) => {
      prices.set(item.symbol, parseFloat(item.lastPrice));
    });
    return prices;
  } catch (error) {
    console.error('获取 Binance 最新价格失败:', error);
    return new Map();
  }
}

/**
 * 获取 Binance 未平仓量
 * API: GET /fapi/v1/openInterest
 * 参考: https://developers.binance.com/docs/zh-CN/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest
 * 返回格式: { "openInterest": "10659.509", "symbol": "BTCUSDT", "time": 1589437530011 }
 * 注意：只返回 openInterest（张数），需要结合标记价格计算名义价值
 */
async function getBinanceOpenInterest(markPrices: Map<string, number>): Promise<Map<string, { contracts: number; value: number }>> {
  try {
    const symbols = await getBinanceSymbols();
    const oiMap = new Map<string, { contracts: number; value: number }>();
    
    // 批量获取 OI 数据，平衡速度和速率限制
    // Binance API 限制：每秒最多 10 次请求（权重限制）
    const batchSize = 15; // 增加批次大小到 15
    const delayBetweenBatches = 200; // 减少延迟到 200ms
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const promises = batch.map(async (symbol) => {
        try {
          const response = await axios.get(`${BINANCE_API_BASE}/fapi/v1/openInterest`, {
            params: { symbol }
          });
          
          // API 只返回 openInterest（张数），没有 openInterestValue
          const contracts = parseFloat(response.data.openInterest || '0');
          const markPrice = markPrices.get(symbol) || 0;
          // 计算名义价值：张数 × 标记价格
          const value = contracts * markPrice;
          
          return { symbol, contracts, value };
        } catch (error) {
          console.error(`获取 ${symbol} OI 失败:`, error);
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(result => {
        if (result) {
          oiMap.set(result.symbol, { contracts: result.contracts, value: result.value });
        }
      });
      
      // 批次之间添加延迟（最后一个批次不需要延迟）
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
    
    return oiMap;
  } catch (error) {
    console.error('获取 Binance 未平仓量失败:', error);
    return new Map();
  }
}

/**
 * 获取 Binance 保险基金余额
 * API: GET /fapi/v1/insuranceBalance
 * 参考: https://developers.binance.com/docs/zh-CN/derivatives/usds-margined-futures/market-data/rest-api/Insurance-Fund-Balance
 */
async function getBinanceInsuranceFund(): Promise<Map<string, number>> {
  try {
    // 不传 symbol 参数，获取所有合约的保险基金余额
    const response = await axios.get(`${BINANCE_API_BASE}/fapi/v1/insuranceBalance`);
    const fundMap = new Map<string, number>();

    // 如果返回的是数组格式（不传 symbol 时）
    if (Array.isArray(response.data)) {
      response.data.forEach((group: any) => {
        if (group.symbols && group.assets) {
          // 找到 USDT 资产
          const usdtAsset = group.assets.find((a: any) => a.asset === 'USDT');
          if (usdtAsset) {
            const fundBalance = parseFloat(usdtAsset.marginBalance || '0');
            // 将保险基金余额分配给该组的所有 symbol
            group.symbols.forEach((symbol: string) => {
              // 如果是永续合约（不包含下划线），则分配保险基金
              // 注意：这里简化处理，将总余额平均分配给所有 symbol
              // 实际应用中可能需要更复杂的分配逻辑
              if (!symbol.includes('_')) {
                fundMap.set(symbol, fundBalance / group.symbols.length);
              }
            });
          }
        }
      });
    } else if (response.data.assets) {
      // 如果返回的是对象格式（传了 symbol 时）
      const usdtAsset = response.data.assets.find((a: any) => a.asset === 'USDT');
      if (usdtAsset && response.data.symbols) {
        const fundBalance = parseFloat(usdtAsset.marginBalance || '0');
        response.data.symbols.forEach((symbol: string) => {
          if (!symbol.includes('_')) {
            fundMap.set(symbol, fundBalance / response.data.symbols.length);
          }
        });
      }
    }

    return fundMap;
  } catch (error) {
    console.error('获取 Binance 保险基金余额失败:', error);
    return new Map();
  }
}

/**
 * 获取所有 Binance 永续合约数据
 */
export async function getBinancePerps(): Promise<BinancePerpData[]> {
  try {
    const [symbols, markPrices, lastPrices, insuranceFund] = await Promise.all([
      getBinanceSymbols(),
      getBinanceMarkPrices(),
      getBinanceLastPrices(),
      getBinanceInsuranceFund(),
    ]);

    // 获取 OI 数据需要 markPrices，所以在这里调用
    const openInterest = await getBinanceOpenInterest(markPrices);

    const results: BinancePerpData[] = [];

    for (const symbol of symbols) {
      const markPrice = markPrices.get(symbol) || 0;
      const lastPrice = lastPrices.get(symbol) || 0;
      const oi = openInterest.get(symbol);
      const fund = insuranceFund.get(symbol) || 0;

      if (oi && (markPrice > 0 || lastPrice > 0)) {
        results.push({
          symbol,
          markPrice,
          lastPrice,
          openInterest: oi.contracts,
          openInterestValue: oi.value,
          insuranceFund: fund,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('获取 Binance 数据失败:', error);
    return [];
  }
}

