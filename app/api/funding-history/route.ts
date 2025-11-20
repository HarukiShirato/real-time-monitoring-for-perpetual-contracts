import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const exchange = searchParams.get('exchange');

  if (!symbol || !exchange) {
    return NextResponse.json({ error: 'Missing symbol or exchange' }, { status: 400 });
  }

  try {
    let historyData: { time: number; rate: number }[] = [];
    let constituents: { exchange: string; symbol: string; price: number; weight: number }[] = [];

    if (exchange === 'Binance') {
      // Binance API: GET /fapi/v1/fundingRate
      // Returns latest funding rate history
      const response = await axios.get('https://fapi.binance.com/fapi/v1/fundingRate', {
        params: {
          symbol: symbol,
          limit: 100 // Get last 100 periods
        }
      });
      
      historyData = response.data.map((item: any) => ({
        time: item.fundingTime,
        rate: parseFloat(item.fundingRate)
      }));

      try {
        const constituentsRes = await axios.get('https://fapi.binance.com/fapi/v1/constituents', {
          params: { symbol }
        });
        if (constituentsRes.data?.constituents) {
          constituents = constituentsRes.data.constituents.map((entry: any) => ({
            exchange: entry.exchange,
            symbol: entry.symbol,
            price: parseFloat(entry.price || '0'),
            weight: parseFloat(entry.weight || '0')
          }));
        }
      } catch (err) {
        console.error('Failed to fetch Binance constituents:', err);
      }

    } else if (exchange === 'Bybit') {
      // Bybit API: GET /v5/market/funding/history
      const response = await axios.get('https://api.bybit.com/v5/market/funding/history', {
        params: {
          category: 'linear',
          symbol: symbol,
          limit: 100
        }
      });

      if (response.data.retCode === 0 && response.data.result.list) {
        // Bybit returns data in reverse chronological order
        historyData = response.data.result.list.map((item: any) => ({
          time: parseInt(item.fundingRateTimestamp),
          rate: parseFloat(item.fundingRate)
        })).reverse();
      }
    }

    return NextResponse.json({ success: true, data: historyData, constituents });
  } catch (error) {
    console.error('Failed to fetch funding history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

