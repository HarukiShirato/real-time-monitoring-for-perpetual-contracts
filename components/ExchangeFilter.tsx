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
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Exchanges</span>
      <div className="flex flex-wrap gap-2">
        {exchanges.map(exchange => {
          const isSelected = selectedExchanges.has(exchange);
          return (
            <label
              key={exchange}
              className={`
                relative flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-200 border select-none text-sm
                ${isSelected 
                  ? 'bg-brand-accent/10 border-brand-accent text-brand-accent shadow-[0_0_15px_rgba(240,185,11,0.15)]' 
                  : 'bg-brand-surface border-brand-border text-brand-text-secondary hover:border-brand-text-muted hover:text-brand-text-primary'}
              `}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(exchange)}
                className="hidden" 
              />
              <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-200 ${isSelected ? 'bg-brand-accent shadow-[0_0_8px_rgba(240,185,11,0.8)]' : 'bg-brand-text-muted'}`} />
              <span className="font-medium">{exchange}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
