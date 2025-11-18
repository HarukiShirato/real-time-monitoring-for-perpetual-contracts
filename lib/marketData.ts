import axios from 'axios';

/**
 * 市值和 FDV 数据接口
 * 使用 DefiLlama API 获取加密货币市值数据
 * 参考: https://api-docs.defillama.com/#tag/coins
 */

export interface MarketData {
  marketCap: number | null; // 市值（USD）
  fdv: number | null; // 完全稀释估值（USD）
}

const DEFILLAMA_API_BASE = 'https://coins.llama.fi';

// 币对符号到 DefiLlama coin ID 的映射
// DefiLlama 使用格式: coingecko:coinId
const SYMBOL_TO_DEFILLAMA_ID: Record<string, string> = {
  'BTC': 'coingecko:bitcoin',
  'ETH': 'coingecko:ethereum',
  'BNB': 'coingecko:binancecoin',
  'SOL': 'coingecko:solana',
  'XRP': 'coingecko:ripple',
  'ADA': 'coingecko:cardano',
  'DOGE': 'coingecko:dogecoin',
  'TRX': 'coingecko:tron',
  'DOT': 'coingecko:polkadot',
  'MATIC': 'coingecko:matic-network',
  'AVAX': 'coingecko:avalanche-2',
  'LINK': 'coingecko:chainlink',
  'UNI': 'coingecko:uniswap',
  'ATOM': 'coingecko:cosmos',
  'ETC': 'coingecko:ethereum-classic',
  'LTC': 'coingecko:litecoin',
  'NEAR': 'coingecko:near',
  'APT': 'coingecko:aptos',
  'ARB': 'coingecko:arbitrum',
  'OP': 'coingecko:optimism',
  'SUI': 'coingecko:sui',
  'INJ': 'coingecko:injective-protocol',
  'TIA': 'coingecko:celestia',
  'SEI': 'coingecko:sei-network',
  'WLD': 'coingecko:worldcoin-wld',
  'PEPE': 'coingecko:pepe',
  'SHIB': 'coingecko:shiba-inu',
  'FLOKI': 'coingecko:floki',
  'CRV': 'coingecko:curve-dao-token',
  'AAVE': 'coingecko:aave',
  'MKR': 'coingecko:maker',
  'COMP': 'coingecko:compound-governance-token',
  'SNX': 'coingecko:havven',
  'SUSHI': 'coingecko:sushi',
  '1INCH': 'coingecko:1inch',
  'YFI': 'coingecko:yearn-finance',
  'BAL': 'coingecko:balancer',
  'ALPHA': 'coingecko:alpha-finance',
  'CAKE': 'coingecko:pancakeswap-token',
  'FTM': 'coingecko:fantom',
  'ALGO': 'coingecko:algorand',
  'FIL': 'coingecko:filecoin',
  'ICP': 'coingecko:internet-computer',
  'THETA': 'coingecko:theta-token',
  'EOS': 'coingecko:eos',
  'XLM': 'coingecko:stellar',
  'VET': 'coingecko:vechain',
  'HBAR': 'coingecko:hedera-hashgraph',
  'AXS': 'coingecko:axie-infinity',
  'SAND': 'coingecko:the-sandbox',
  'MANA': 'coingecko:decentraland',
  'GALA': 'coingecko:gala',
  'ENJ': 'coingecko:enjincoin',
  'CHZ': 'coingecko:chiliz',
  'FLOW': 'coingecko:flow',
  'EGLD': 'coingecko:elrond-erd-2',
  'ZIL': 'coingecko:zilliqa',
  'IOTA': 'coingecko:iota',
  'XTZ': 'coingecko:tezos',
  'KLAY': 'coingecko:klay-token',
  'ZEC': 'coingecko:zcash',
  'DASH': 'coingecko:dash',
  'BCH': 'coingecko:bitcoin-cash',
};

// 币种符号到 DefiLlama coin ID 的自动匹配缓存
const symbolToIdCache = new Map<string, string>();

/**
 * 通过币种符号查找 DefiLlama coin ID
 * DefiLlama 使用 coingecko:coinId 格式，所以我们可以复用 CoinGecko 的查找逻辑
 */
async function findDefiLlamaIdBySymbol(symbol: string): Promise<string | null> {
  // 先检查缓存
  if (symbolToIdCache.has(symbol)) {
    return symbolToIdCache.get(symbol) || null;
  }

  // 使用 CoinGecko 的搜索 API 来查找币种 ID
  try {
    const searchResponse = await axios.get('https://api.coingecko.com/api/v3/search', {
      params: {
        query: symbol,
      },
    });

    if (searchResponse.data && searchResponse.data.coins) {
      const symbolUpper = symbol.toUpperCase();
      const symbolMatch = searchResponse.data.coins.find(
        (coin: any) => coin.symbol.toUpperCase() === symbolUpper
      );
      
      if (symbolMatch) {
        // DefiLlama 使用 coingecko:coinId 格式
        const llamaId = `coingecko:${symbolMatch.id}`;
        symbolToIdCache.set(symbol, llamaId);
        return llamaId;
      }
    }
  } catch (error) {
    console.warn(`搜索 ${symbol} 失败:`, error);
  }

  return null;
}

// 缓存市场数据，避免频繁请求
const marketDataCache = new Map<string, { data: MarketData; timestamp: number }>();
const CACHE_TTL = 300000; // 缓存 5 分钟（300 秒）

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
 * 使用 DefiLlama API
 */
async function getCoinMarketData(coinId: string): Promise<MarketData> {
  try {
    // DefiLlama coins API: GET /coins/{coins}
    const response = await axios.get(`${DEFILLAMA_API_BASE}/coins/${coinId}`);

    // DefiLlama 返回格式: { coins: { [coinId]: { price, symbol, timestamp, marketCap, fdv, ... } } }
    if (response.data && response.data.coins) {
      const coin = response.data.coins[coinId];
      if (coin) {
        return {
          marketCap: coin.marketCap || coin.mcap || null,
          fdv: coin.fdv || coin.fullyDilutedMarketCap || null,
        };
      }
    }

    return { marketCap: null, fdv: null };
  } catch (error: any) {
    console.error(`获取 ${coinId} 市场数据失败:`, error?.message || error);
    return { marketCap: null, fdv: null };
  }
}

/**
 * 批量获取多个币种的市场数据
 * 使用 DefiLlama API
 */
async function getBatchMarketData(coinIds: string[]): Promise<Map<string, MarketData>> {
  if (coinIds.length === 0) {
    return new Map();
  }

  const resultMap = new Map<string, MarketData>();

  try {
    // DefiLlama coins API 支持批量查询，使用逗号分隔
    const coinsParam = coinIds.join(',');
    const response = await axios.get(`${DEFILLAMA_API_BASE}/coins/${coinsParam}`);

    // DefiLlama 返回格式: { coins: { [coinId]: { price, symbol, timestamp, marketCap, fdv, ... } } }
    if (response.data && response.data.coins) {
      coinIds.forEach(coinId => {
        const coin = response.data.coins[coinId];
        if (coin) {
          resultMap.set(coinId, {
            marketCap: coin.marketCap || coin.mcap || null,
            fdv: coin.fdv || coin.fullyDilutedMarketCap || null,
          });
        } else {
          resultMap.set(coinId, { marketCap: null, fdv: null });
        }
      });
    } else {
      coinIds.forEach(coinId => {
        resultMap.set(coinId, { marketCap: null, fdv: null });
      });
    }
  } catch (error: any) {
    console.error('批量获取市场数据失败:', error?.message || error);
    coinIds.forEach(coinId => {
      resultMap.set(coinId, { marketCap: null, fdv: null });
    });
  }

  // 确保所有 coinId 都有结果
  coinIds.forEach(coinId => {
    if (!resultMap.has(coinId)) {
      resultMap.set(coinId, { marketCap: null, fdv: null });
    }
  });

  return resultMap;
}

/**
 * 获取币对的市场数据（市值和 FDV）
 * @param symbol 合约符号，如 BTCUSDT
 * @returns 市场数据对象
 */
export async function getMarketData(symbol: string): Promise<MarketData> {
  const baseSymbol = extractBaseSymbol(symbol);
  
  // 先检查预定义的映射
  let coinId = SYMBOL_TO_DEFILLAMA_ID[baseSymbol];
  
  // 如果没有预定义，尝试自动查找
  if (!coinId) {
    coinId = await findDefiLlamaIdBySymbol(baseSymbol) || '';
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
  
  // 为每个基础币种查找 DefiLlama ID（并行处理）
  const symbolToCoinIdMap = new Map<string, string>();
  
  // 先处理所有预定义的映射（同步）
  const symbolsNeedingLookup: string[] = [];
  baseSymbols.forEach(baseSymbol => {
    const coinId = SYMBOL_TO_DEFILLAMA_ID[baseSymbol];
    if (coinId) {
      symbolToCoinIdMap.set(baseSymbol, coinId);
    } else {
      symbolsNeedingLookup.push(baseSymbol);
    }
  });
  
  // 限制并发数查找未预定义的币种，平衡速度和速率限制
  // CoinGecko 免费版限制：每分钟最多 10-50 次请求
  if (symbolsNeedingLookup.length > 0) {
    const concurrency = 5; // 增加到5个并发请求
    const delayBetweenBatches = 300; // 减少延迟到 300ms
    
    for (let i = 0; i < symbolsNeedingLookup.length; i += concurrency) {
      const batch = symbolsNeedingLookup.slice(i, i + concurrency);
      const batchPromises = batch.map(async (baseSymbol) => {
        const coinId = await findDefiLlamaIdBySymbol(baseSymbol);
        if (coinId) {
          symbolToCoinIdMap.set(baseSymbol, coinId);
        }
        return { baseSymbol, coinId };
      });
      
      await Promise.all(batchPromises);
      
      // 批次之间添加延迟（最后一个批次不需要延迟）
      if (i + concurrency < symbolsNeedingLookup.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
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

  // 批量获取未缓存的数据（一次性获取所有，DefiLlama 支持批量查询）
  if (uncachedIds.length > 0) {
    try {
      const batchData = await getBatchMarketData(uncachedIds);
      batchData.forEach((data, coinId) => {
        resultMap.set(coinId, data);
        marketDataCache.set(coinId, { data, timestamp: Date.now() });
      });
    } catch (error) {
      console.error('批量获取市场数据失败:', error);
      // 如果批量获取失败，为每个币种设置 null
      uncachedIds.forEach(coinId => {
        if (!resultMap.has(coinId)) {
          resultMap.set(coinId, { marketCap: null, fdv: null });
        }
      });
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

