'use client';

interface FilterControlsProps {
  minOi: number;
  maxOi: number;
  minFundOiRatio: number;
  maxFundOiRatio: number;
  onMinOiChange: (value: number) => void;
  onMinFundOiRatioChange: (value: number) => void;
}

export default function FilterControls({
  minOi,
  maxOi,
  minFundOiRatio,
  maxFundOiRatio,
  onMinOiChange,
  onMinFundOiRatioChange,
}: FilterControlsProps) {
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
          最小 OI (USDT):
        </label>
        <input
          type="number"
          min="0"
          step="1000"
          value={minOi}
          onChange={(e) => onMinOiChange(Number(e.target.value))}
          className="w-32 px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
          最小保险基金/OI (%):
        </label>
        <input
          type="number"
          min="0"
          max={maxFundOiRatio}
          step="0.01"
          value={minFundOiRatio}
          onChange={(e) => onMinFundOiRatioChange(Number(e.target.value))}
          className="w-32 px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

