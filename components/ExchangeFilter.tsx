'use client';

interface ExchangeFilterProps {
  exchanges: string[];
  selectedExchanges: Set<string>;
  onToggle: (exchange: string) => void;
}

export default function ExchangeFilter({
  exchanges,
  selectedExchanges,
  onToggle,
}: ExchangeFilterProps) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm font-medium text-gray-700">交易所:</span>
      <div className="flex gap-2">
        {exchanges.map(exchange => (
          <label
            key={exchange}
            className="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedExchanges.has(exchange)}
              onChange={() => onToggle(exchange)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{exchange}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

