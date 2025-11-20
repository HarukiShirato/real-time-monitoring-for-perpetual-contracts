import axios from 'axios';

/**
 * 市值和 FDV 数据接口
 * 使用 CoinGecko API 获取加密货币市值数据
 * 参考: https://www.coingecko.com/en/api/documentation
 */

export interface MarketData {
  marketCap: number | null; // 市值（USD）
  fdv: number | null; // 完全稀释估值（USD）
  name?: string; // 币种名称 (e.g. Bitcoin)
  image?: string; // 币种图标 URL
}

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// 币对符号到 CoinGecko ID 的映射（常用币种缓存）
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'BNB': 'binancecoin',
  'SOL': 'solana',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'TRX': 'tron',
  'DOT': 'polkadot',
  'MATIC': 'matic-network',
  'AVAX': 'avalanche-2',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'ATOM': 'cosmos',
  'ETC': 'ethereum-classic',
  'LTC': 'litecoin',
  'NEAR': 'near',
  'APT': 'aptos',
  'ARB': 'arbitrum',
  'OP': 'optimism',
  'SUI': 'sui',
  'INJ': 'injective-protocol',
  'TIA': 'celestia',
  'SEI': 'sei-network',
  'WLD': 'worldcoin-wld',
  'PEPE': 'pepe',
  'SHIB': 'shiba-inu',
  'FLOKI': 'floki',
};

// 币种符号到 CoinGecko ID 的自动匹配缓存
const symbolToIdCache = new Map<string, string>();
let coinsListCache: any[] | null = null;
let coinsListCacheTime = 0;
const COINS_LIST_CACHE_TTL = 3600000; // 缓存 1 小时（币种列表变化不频繁）

/**
 * 获取 CoinGecko 币种列表（带缓存）
 */
async function getCoinsList(): Promise<any[]> {
  // 检查缓存
  if (coinsListCache && Date.now() - coinsListCacheTime < COINS_LIST_CACHE_TTL) {
    return coinsListCache;
  }

  try {
    // 使用 /coins/list 接口获取所有币种列表
    const response = await axios.get(`${COINGECKO_API_BASE}/coins/list`, {
      params: {
        include_platform: false,
      },
    });

    coinsListCache = response.data;
    coinsListCacheTime = Date.now();
    return response.data;
  } catch (error) {
    console.error('获取 CoinGecko 币种列表失败:', error);
    // 如果失败但缓存存在，返回缓存
    if (coinsListCache) {
      return coinsListCache;
    }
    return [];
  }
}

/**
 * 通过币种符号自动查找 CoinGecko ID
 * 使用 /coins/list 接口获取所有币种列表并匹配
 */
async function findCoinGeckoIdBySymbol(symbol: string): Promise<string | null> {
  // 先检查缓存
  if (symbolToIdCache.has(symbol)) {
    return symbolToIdCache.get(symbol) || null;
  }

  try {
    const coinsList = await getCoinsList();
    
    // 查找匹配的币种（精确匹配，大小写不敏感）
    const symbolUpper = symbol.toUpperCase();
    const exactMatch = coinsList.find((coin: any) => coin.symbol.toUpperCase() === symbolUpper);
    
    if (exactMatch) {
      symbolToIdCache.set(symbol, exactMatch.id);
      return exactMatch.id;
    }

    return null;
  } catch (error) {
    console.error(`查找 ${symbol} 的 CoinGecko ID 失败:`, error);
    return null;
  }
}

// 缓存市场数据，避免频繁请求
const marketDataCache = new Map<string, { data: MarketData; timestamp: number }>();
const CACHE_TTL = 60000; // 缓存 60 秒

/**
 * 从合约符号中提取基础币种
 * 例如：BTCUSDT -> BTC, ETHUSDT -> ETH
 */
function extractBaseSymbol(symbol: string): string {
  // 移除常见的计价货币后缀
  const suffixes = ['USDT', 'USD', 'BUSD', 'USDC', 'EUR', 'GBP'];
  for (const suffix of suffixes) {
    if (symbol.endsWith(suffix)) {
      return symbol.slice(0, -suffix.length);
    }
  }
  return symbol;
}

/**
 * 获取单个币种的市场数据
 * 使用 /coins/markets 接口，这个接口返回更完整的数据包括 FDV
 */
async function getCoinMarketData(coinId: string): Promise<MarketData> {
  try {
    // 使用 /coins/markets 接口，这个接口返回市值和 FDV
    const response = await axios.get(`${COINGECKO_API_BASE}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        ids: coinId,
        order: 'market_cap_desc',
        per_page: 1,
        page: 1,
        sparkline: false,
      },
    });

    if (response.data && response.data.length > 0) {
      const data = response.data[0];
      return {
        marketCap: data.market_cap || null,
        fdv: data.fully_diluted_valuation || null,
        name: data.name,
        image: data.image
      };
    }

    return { marketCap: null, fdv: null };
  } catch (error) {
    console.error(`获取 ${coinId} 市场数据失败:`, error);
    return { marketCap: null, fdv: null };
  }
}

/**
 * 批量获取多个币种的市场数据
 * 使用 /coins/markets 接口，这个接口返回更完整的数据包括 FDV
 */
async function getBatchMarketData(coinIds: string[]): Promise<Map<string, MarketData>> {
  if (coinIds.length === 0) {
    return new Map();
  }

  try {
    // 使用 /coins/markets 接口，支持批量查询
    const response = await axios.get(`${COINGECKO_API_BASE}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        ids: coinIds.join(','),
        order: 'market_cap_desc',
        per_page: 250, // CoinGecko 允许最多 250 个
        page: 1,
        sparkline: false,
      },
    });

    const resultMap = new Map<string, MarketData>();
    
    // 创建 ID 到数据的映射
    const dataMap = new Map<string, any>();
    if (response.data && Array.isArray(response.data)) {
      response.data.forEach((coin: any) => {
        dataMap.set(coin.id, coin);
      });
    }

    // 为每个请求的 coinId 设置结果
    coinIds.forEach(coinId => {
      const data = dataMap.get(coinId);
      if (data) {
        resultMap.set(coinId, {
          marketCap: data.market_cap || null,
          fdv: data.fully_diluted_valuation || null,
          name: data.name,
          image: data.image
        });
      } else {
        resultMap.set(coinId, { marketCap: null, fdv: null });
      }
    });

    return resultMap;
  } catch (error) {
    console.error('批量获取市场数据失败:', error);
    return new Map();
  }
}

/**
 * 获取币对的市场数据（市值和 FDV）
 * @param symbol 合约符号，如 BTCUSDT
 * @returns 市场数据对象
 */
export async function getMarketData(symbol: string): Promise<MarketData> {
  const baseSymbol = extractBaseSymbol(symbol);
  
  // 先检查预定义的映射
  let coinId = SYMBOL_TO_COINGECKO_ID[baseSymbol];
  
  // 如果没有预定义，尝试自动查找
  if (!coinId) {
    coinId = await findCoinGeckoIdBySymbol(baseSymbol) || '';
  }

  if (!coinId) {
    return { marketCap: null, fdv: null };
  }

  // 检查缓存
  const cached = marketDataCache.get(coinId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // 获取新数据
  const data = await getCoinMarketData(coinId);
  marketDataCache.set(coinId, { data, timestamp: Date.now() });
  return data;
}

/**
 * 批量获取多个币对的市场数据
 * @param symbols 合约符号数组
 * @returns 映射表：symbol -> MarketData
 */
export async function getBatchMarketDataForSymbols(symbols: string[]): Promise<Map<string, MarketData>> {
  // 提取所有基础币种并去重
  const baseSymbols = [...new Set(symbols.map(extractBaseSymbol))];
  
  // 为每个基础币种查找 CoinGecko ID
  const symbolToCoinIdMap = new Map<string, string>();
  
  for (const baseSymbol of baseSymbols) {
    // 先检查预定义的映射
    let coinId = SYMBOL_TO_COINGECKO_ID[baseSymbol];
    
    // 如果没有预定义，尝试自动查找
    if (!coinId) {
      coinId = await findCoinGeckoIdBySymbol(baseSymbol) || '';
    }
    
    if (coinId) {
      symbolToCoinIdMap.set(baseSymbol, coinId);
    }
  }

  const coinIds = Array.from(symbolToCoinIdMap.values());

  if (coinIds.length === 0) {
    return new Map();
  }

  // 检查缓存
  const uncachedIds: string[] = [];
  const resultMap = new Map<string, MarketData>();

  coinIds.forEach(coinId => {
    const cached = marketDataCache.get(coinId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      resultMap.set(coinId, cached.data);
    } else {
      uncachedIds.push(coinId);
    }
  });

  // 批量获取未缓存的数据（分批处理，避免超过 API 限制）
  if (uncachedIds.length > 0) {
    const batchSize = 250; // CoinGecko 允许最多 250 个
    for (let i = 0; i < uncachedIds.length; i += batchSize) {
      const batch = uncachedIds.slice(i, i + batchSize);
      const batchData = await getBatchMarketData(batch);
      batchData.forEach((data, coinId) => {
        resultMap.set(coinId, data);
        marketDataCache.set(coinId, { data, timestamp: Date.now() });
      });
      
      // 避免速率限制，稍微延迟
      if (i + batchSize < uncachedIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // 将结果映射回原始符号
  const symbolMap = new Map<string, MarketData>();
  symbols.forEach(symbol => {
    const baseSymbol = extractBaseSymbol(symbol);
    const coinId = symbolToCoinIdMap.get(baseSymbol);
    if (coinId && resultMap.has(coinId)) {
      symbolMap.set(symbol, resultMap.get(coinId)!);
    } else {
      symbolMap.set(symbol, { marketCap: null, fdv: null });
    }
  });

  return symbolMap;
}
