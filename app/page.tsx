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
        setError(result.error || '获取数据失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error('获取数据失败:', err);
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

      return true;
    });
  }, [data, selectedExchanges, searchQuery, minOi, minFundOiRatio]);

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

  const formatTime = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">永续合约数据仪表盘</h1>
          <p className="mt-2 text-sm text-gray-600">
            实时监控 Binance 和 Bybit 永续合约数据
          </p>
        </div>

        {/* 控制栏 */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <ExchangeFilter
              exchanges={['Binance', 'Bybit', 'Bitget', 'Gate', 'OKX']}
              selectedExchanges={selectedExchanges}
              onToggle={toggleExchange}
            />
            <div className="flex-1" />
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <FilterControls
              minOi={minOi}
              maxOi={maxOi}
              minFundOiRatio={minFundOiRatio}
              maxFundOiRatio={maxFundOiRatio}
              onMinOiChange={setMinOi}
              onMinFundOiRatioChange={setMinFundOiRatio}
            />
            <div className="flex-1" />
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '刷新中...' : '手动刷新'}
            </button>
            {lastUpdate && (
              <span className="text-sm text-gray-600">
                最近更新: {formatTime(lastUpdate)}
              </span>
            )}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* 数据统计 */}
        <div className="mb-4 text-sm text-gray-600">
          显示 {filteredData.length} / {data.length} 条记录
        </div>

        {/* 表格 */}
        {loading && data.length === 0 ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : (
          <PerpTable data={filteredData} />
        )}
      </div>
    </div>
  );
}

