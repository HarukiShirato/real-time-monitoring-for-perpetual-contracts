'use client';

import { useState } from 'react';

export interface PerpData {
  symbol: string;
  exchange: 'Binance' | 'Bybit';
  price: number;
  openInterest: number;
  openInterestValue: number;
  insuranceFund: number;
  fundOiRatio: number;
  marketCap: number | null;
  fdv: number | null;
}

type SortKey = keyof PerpData | 'none';
type SortOrder = 'asc' | 'desc';

interface PerpTableProps {
  data: PerpData[];
}

export default function PerpTable({ data }: PerpTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('none');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (key: SortKey) => {
    if (key === 'none') {
      setSortKey('none');
      return;
    }

    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedData = [...data].sort((a, b) => {
    if (sortKey === 'none') return 0;

    let aVal: any = a[sortKey as keyof PerpData];
    let bVal: any = b[sortKey as keyof PerpData];

    // 处理 null 值
    if (aVal === null) aVal = -Infinity;
    if (bVal === null) bVal = -Infinity;

    if (typeof aVal === 'string') {
      return sortOrder === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const formatNumber = (num: number | null, decimals: number = 2): string => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
    return num.toFixed(decimals);
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) {
      return (
        <span className="text-gray-400 ml-1">
          <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </span>
      );
    }
    return (
      <span className="text-blue-600 ml-1">
        {sortOrder === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('symbol')}
            >
              合约/币对
              <SortIcon columnKey="symbol" />
            </th>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('exchange')}
            >
              交易所
              <SortIcon columnKey="exchange" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('price')}
            >
              合约价格 (USDT)
              <SortIcon columnKey="price" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('openInterestValue')}
            >
              OI 量 (USDT)
              <SortIcon columnKey="openInterestValue" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('insuranceFund')}
            >
              保险基金 (USDT)
              <SortIcon columnKey="insuranceFund" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('fundOiRatio')}
            >
              保险基金/OI (%)
              <SortIcon columnKey="fundOiRatio" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('marketCap')}
            >
              市值 (USD)
              <SortIcon columnKey="marketCap" />
            </th>
            <th
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => handleSort('fdv')}
            >
              FDV (USD)
              <SortIcon columnKey="fdv" />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sortedData.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                暂无数据
              </td>
            </tr>
          ) : (
            sortedData.map((item, index) => (
              <tr key={`${item.symbol}-${item.exchange}-${index}`} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {item.symbol}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {item.exchange}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatNumber(item.price, 2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatNumber(item.openInterestValue, 2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatNumber(item.insuranceFund, 2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {item.fundOiRatio > 0 ? `${item.fundOiRatio.toFixed(4)}%` : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatNumber(item.marketCap, 2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatNumber(item.fdv, 2)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

