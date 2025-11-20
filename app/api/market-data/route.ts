import { NextResponse } from 'next/server';
import { getBatchMarketDataForSymbols } from '@/lib/marketData';

/**
 * GET /api/market-data?symbols=BTCUSDT,ETHUSDT
 * 获取市值数据（异步调用，不阻塞主数据）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    
    if (!symbolsParam) {
      return NextResponse.json(
        {
          success: false,
          error: '缺少 symbols 参数',
          data: {},
        },
        { status: 400 }
      );
    }

    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    
    if (symbols.length === 0) {
      return NextResponse.json({
        success: true,
        data: {},
        timestamp: Date.now(),
      });
    }

    // 批量获取市值数据
    const marketDataMap = await getBatchMarketDataForSymbols(symbols);

    // 转换为对象格式
    const result: Record<string, { marketCap: number | null; fdv: number | null }> = {};
    marketDataMap.forEach((data, symbol) => {
      result[symbol] = data;
    });

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('获取市值数据失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: '获取市值数据失败',
        data: {},
      },
      { status: 500 }
    );
  }
}


