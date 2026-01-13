'use client';

import { useState, useEffect, useMemo } from 'react';
import ExchangeFilter from '@/components/ExchangeFilter';
import SearchBox from '@/components/SearchBox';
import FilterControls from '@/components/FilterControls';
import PerpTable, { PerpData } from '@/components/PerpTable';

export default function Home() {
  const [data, setData] = useState<PerpData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // 过滤状态
  const [selectedExchanges, setSelectedExchanges] = useState<Set<string>>(
    new Set(['Binance', 'Bybit'])
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [minOi, setMinOi] = useState(0);
  const [minFundOiRatio, setMinFundOiRatio] = useState(0);
  const [minMarketCap, setMinMarketCap] = useState(0);
  const [minFdv, setMinFdv] = useState(0);
  const [selectedIntervals, setSelectedIntervals] = useState<Set<number>>(new Set());

  // 获取数据
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/perps');
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        setLastUpdate(new Date());
      } else {
        setError(result.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Network request failed');
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    fetchData();
  }, []);

  // 自动刷新（每 5 分钟）
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 300000); // 5分钟 = 300000毫秒

    return () => clearInterval(interval);
  }, []);

  // 计算过滤后的数据
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // 交易所过滤
      if (!selectedExchanges.has(item.exchange)) {
        return false;
      }

      // 搜索过滤
      if (searchQuery && !item.symbol.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // OI 过滤
      if (item.openInterestValue < minOi) {
        return false;
      }

      // 保险基金/OI 比例过滤
      if (item.fundOiRatio < minFundOiRatio) {
        return false;
      }

      // 结算间隔过滤
      const interval = item.fundingIntervalHours || 8;
      if (selectedIntervals.size > 0 && !selectedIntervals.has(interval)) {
        return false;
      }

      // 市值过滤
      if (minMarketCap > 0 && (!item.marketCap || item.marketCap < minMarketCap)) {
        return false;
      }

      // FDV 过滤
      if (minFdv > 0 && (!item.fdv || item.fdv < minFdv)) {
        return false;
      }

      return true;
    });
  }, [data, selectedExchanges, searchQuery, minOi, minFundOiRatio, minMarketCap, minFdv, selectedIntervals]);

  // 计算最大值（用于过滤器）
  const maxOi = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map(item => item.openInterestValue));
  }, [data]);

  const maxFundOiRatio = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map(item => item.fundOiRatio));
  }, [data]);

  const toggleExchange = (exchange: string) => {
    setSelectedExchanges(prev => {
      const next = new Set(prev);
      if (next.has(exchange)) {
        next.delete(exchange);
      } else {
        next.add(exchange);
      }
      return next;
    });
  };

  const toggleInterval = (hours: number) => {
    setSelectedIntervals(prev => {
      const next = new Set(prev);
      if (next.has(hours)) {
        next.delete(hours);
      } else {
        next.add(hours);
      }
      return next;
    });
  };

  const availableIntervals = useMemo(() => {
    const intervals = new Set<number>();
    data.forEach(item => {
      intervals.add(item.fundingIntervalHours || 8);
    });
    return Array.from(intervals).sort((a, b) => a - b);
  }, [data]);

  const formatTime = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  return (
    <div className="min-h-screen bg-brand-dark relative overflow-x-hidden selection:bg-brand-accent/30">
       {/* Decorative Background Elements */}
       <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-brand-surface/20 to-transparent pointer-events-none" />
       <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-accent/5 rounded-full blur-3xl pointer-events-none" />
       <div className="absolute top-48 -left-24 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
           <div>
             <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-brand-text-primary via-brand-text-primary to-brand-text-secondary tracking-tight">
               Perp Analytics
             </h1>
             <p className="mt-2 text-brand-text-secondary text-lg">
               Real-time monitoring for Binance & Bybit perpetual contracts
             </p>
           </div>
           
           <div className="flex items-center gap-4">
              <div className="text-right hidden md:block">
                 <div className="text-xs text-brand-text-secondary uppercase tracking-wider">Last Update</div>
                 <div className="text-brand-text-primary font-mono">{lastUpdate ? formatTime(lastUpdate) : '--:--:--'}</div>
              </div>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-brand-surface border border-brand-border rounded-lg text-brand-text-primary hover:bg-brand-surfaceHighlight hover:border-brand-accent/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group shadow-sm"
              >
                <svg className={`w-4 h-4 text-brand-text-secondary group-hover:text-brand-accent transition-colors ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
           </div>
        </div>

        {/* Controls */}
        <div className="space-y-4 mb-8">
          {/* Top Row: Filter & Search */}
          <div className="glass-panel rounded-xl p-5 flex flex-col lg:flex-row items-start lg:items-center gap-6 justify-between">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 w-full lg:w-auto">
              <ExchangeFilter
                exchanges={['Binance', 'Bybit', 'Bitget', 'Gate', 'OKX']}
                selectedExchanges={selectedExchanges}
                onToggle={toggleExchange}
              />
              <div className="hidden sm:block w-px h-8 bg-brand-border" />
              <SearchBox
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>
          </div>

          {/* Bottom Row: Numerical Filters */}
          <div className="glass-panel rounded-xl p-5 flex flex-wrap items-center gap-6">
            <FilterControls
              minOi={minOi}
              maxOi={maxOi}
              minFundOiRatio={minFundOiRatio}
              maxFundOiRatio={maxFundOiRatio}
              minMarketCap={minMarketCap}
              minFdv={minFdv}
              availableIntervals={availableIntervals}
              selectedIntervals={selectedIntervals}
              onMinOiChange={setMinOi}
              onMinFundOiRatioChange={setMinFundOiRatio}
              onMinMarketCapChange={setMinMarketCap}
              onMinFdvChange={setMinFdv}
              onToggleInterval={toggleInterval}
            />
            
            <div className="flex-1" />
            
            <div className="text-sm text-brand-text-secondary font-medium px-4 py-1.5 bg-brand-dark/50 rounded-md border border-brand-border/50">
              Showing <span className="text-brand-text-primary">{filteredData.length}</span> / {data.length} pairs
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Table */}
        {loading && data.length === 0 ? (
          <div className="text-center py-24 text-brand-text-secondary">
             <div className="animate-spin w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full mx-auto mb-4"></div>
             Loading market data...
          </div>
        ) : (
          <PerpTable data={filteredData} />
        )}
      </div>
    </div>
  );
}
