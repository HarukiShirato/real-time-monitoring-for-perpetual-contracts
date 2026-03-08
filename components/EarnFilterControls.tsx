'use client';

interface EarnFilterControlsProps {
  minCombinedApr: number;
  onMinCombinedAprChange: (value: number) => void;
}

export default function EarnFilterControls({
  minCombinedApr,
  onMinCombinedAprChange,
}: EarnFilterControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-6 text-sm">
      <div className="flex items-center gap-3">
        <label className="text-brand-text-secondary whitespace-nowrap font-medium">
          Min Combined APR
        </label>
        <div className="relative group">
          <input
            type="number"
            min="0"
            max="500"
            step="1"
            value={minCombinedApr}
            onChange={(e) => onMinCombinedAprChange(Number(e.target.value))}
            className="w-20 pl-2 pr-6 py-1 bg-brand-surface border border-brand-border rounded text-brand-text-primary focus:outline-none focus:border-brand-accent text-xs font-mono"
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
            <span className="text-brand-text-muted text-xs">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
