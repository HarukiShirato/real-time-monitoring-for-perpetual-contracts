'use client';

import { useMemo, useState, useEffect } from 'react';

export interface EarnProduct {
  asset: string;
  exchange: 'Binance' | 'Bybit' | 'OKX';
  apr: number;
  minAmount: number;
  maxAmount: number | null;
  coinImage?: string;
  coinName?: string;
  marketCap: number | null;
}

type SortKey = 'asset' | 'exchange' | 'apr' | 'minAmount' | 'marketCap' | 'none';
type SortOrder = 'asc' | 'desc';

interface EarnTableProps {
  data: EarnProduct[];
}

export default function EarnTable({ data }: EarnTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('apr');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // 计算同币种最高 APR
  const bestAprByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data) {
      const current = map.get(item.asset) || 0;
      if (item.apr > current) map.set(item.asset, item.apr);
    }
    return map;
  }, [data]);

  const handleSort = (key: SortKey) => {
    if (key === 'none') return;
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const sortedData = useMemo(() => {
    const next = [...data];
    next.sort((a, b) => {
      if (sortKey === 'none') return 0;
      let aVal: any = a[sortKey as keyof EarnProduct];
      let bVal: any = b[sortKey as keyof EarnProduct];
      if (aVal === null || aVal === undefined) aVal = -Infinity;
      if (bVal === null || bVal === undefined) bVal = -Infinity;
      if (typeof aVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return next;
  }, [data, sortKey, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, pageCount);

  const pagedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, pageSize, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, data, sortKey, sortOrder]);

  const formatNumber = (num: number | null, decimals: number = 2) => {
    if (num === null || num === undefined) return '\u2014';
    if (num >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
    return num.toFixed(decimals);
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    const isActive = sortKey === columnKey;
    return (
      <span className={`ml-1 flex flex-col space-y-[2px] ${isActive ? 'opacity-100' : 'opacity-30 group-hover:opacity-60'}`}>
        <svg className={`w-1.5 h-1 ${isActive && sortOrder === 'asc' ? 'text-brand-accent' : 'text-current'}`} fill="currentColor" viewBox="0 0 10 6">
          <path d="M5 0L10 6H0L5 0Z" />
        </svg>
        <svg className={`w-1.5 h-1 ${isActive && sortOrder === 'desc' ? 'text-brand-accent' : 'text-current'}`} fill="currentColor" viewBox="0 0 10 6">
          <path d="M5 6L0 0H10L5 6Z" />
        </svg>
      </span>
    );
  };

  const Th = ({ id, children, align = 'left', className = '' }: { id: SortKey; children: React.ReactNode; align?: 'left' | 'center' | 'right'; className?: string }) => (
    <th
      className={`
        px-4 py-3 text-${align} text-xs font-semibold text-brand-text-secondary uppercase tracking-wider cursor-pointer
        transition-all duration-200 hover:text-brand-text-primary hover:bg-brand-surfaceHighlight/50 group select-none border-b border-brand-border ${className}
      `}
      onClick={() => handleSort(id)}
    >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
        {children}
        <SortIcon columnKey={id} />
      </div>
    </th>
  );

  const exchangeColors: Record<string, string> = {
    Binance: 'bg-[#FCD535]/10 text-[#FCD535] border-[#FCD535]/20',
    Bybit: 'bg-brand-info/10 text-brand-info border-brand-info/20',
    OKX: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  };

  return (
    <div className="w-full overflow-hidden bg-brand-surface rounded-xl border border-brand-border shadow-xl">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-brand-border">
          <thead>
            <tr className="bg-brand-surface">
              <Th id="asset" className="pl-6">COIN</Th>
              <Th id="asset">ASSET</Th>
              <Th id="exchange">EXCHANGE</Th>
              <Th id="apr" align="right">APR</Th>
              <Th id="minAmount" align="right">MIN AMOUNT</Th>
              <Th id="marketCap" align="right" className="pr-6">M-CAP</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border bg-brand-dark/50">
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-24 text-center">
                  <div className="flex flex-col items-center justify-center text-brand-text-muted">
                    <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>No earn products found</p>
                  </div>
                </td>
              </tr>
            ) : (
              pagedData.map((item) => {
                const isBest = bestAprByAsset.get(item.asset) === item.apr &&
                  data.filter(d => d.asset === item.asset).length > 1;

                return (
                  <tr
                    key={`${item.asset}-${item.exchange}`}
                    className={`transition-colors duration-150 group hover:bg-brand-surfaceHighlight/30 ${isBest ? 'bg-brand-accent/[0.03]' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap pl-6">
                      <div className="flex items-center" title={item.coinName || item.asset}>
                        {item.coinImage ? (
                          <img
                            src={item.coinImage}
                            alt={item.coinName || item.asset}
                            className="w-6 h-6 rounded-full border border-brand-border/60"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center text-[10px] font-bold text-brand-text-secondary group-hover:border-brand-accent/30 group-hover:text-brand-accent transition-colors">
                            {item.asset.substring(0, 1)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-brand-text-secondary font-mono">
                      {item.asset}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${exchangeColors[item.exchange] || ''}`}>
                        {item.exchange}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-mono tracking-tight">
                      <span className={`${isBest ? 'text-brand-accent font-semibold' : 'text-brand-success'}`}>
                        {(item.apr * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-brand-text-secondary text-right font-mono tracking-tight">
                      {item.minAmount > 0 ? formatNumber(item.minAmount, 2) : '\u2014'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-brand-text-secondary text-right font-mono tracking-tight pr-6">
                      {formatNumber(item.marketCap, 1)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-brand-border text-sm text-brand-text-secondary">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            className="bg-brand-surface border border-brand-border rounded px-2 py-1 text-brand-text-primary text-sm"
          >
            {[25, 50, 100, 200].map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-brand-text-muted">
            {sortedData.length === 0
              ? '0 of 0'
              : `${(currentPage - 1) * pageSize + 1}\u2013${Math.min(currentPage * pageSize, sortedData.length)} of ${sortedData.length}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 border border-brand-border rounded text-xs disabled:opacity-50 hover:border-brand-accent/40 transition-colors"
            >
              Prev
            </button>
            <span className="text-xs text-brand-text-primary">
              {currentPage}/{pageCount}
            </span>
            <button
              onClick={() => setPage(prev => Math.min(pageCount, prev + 1))}
              disabled={currentPage === pageCount || sortedData.length === 0}
              className="px-2 py-1 border border-brand-border rounded text-xs disabled:opacity-50 hover:border-brand-accent/40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
