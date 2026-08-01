'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import type { TopMover } from '@/types/mixpanel';

function MoverRow({ mover, up }: { mover: TopMover; up: boolean }) {
  const isNew = mover.previous === 0 && mover.current > 0;
  const pct = mover.change ?? 0;
  const breakdown = mover.breakdown ?? [];
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-ink">{mover.category}</div>
          {mover.unit && <div className="text-[11px] font-mono text-ink-faint">{mover.unit}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-ink-faint tabular-nums">
            {mover.previous} → {mover.current}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium tabular-nums ${
              up ? 'bg-sage-tint text-sage-deep' : 'bg-ember-tint text-ember-deep'
            }`}
          >
            {isNew ? 'New' : `${up ? '↑' : '↓'} ${Math.abs(pct).toFixed(0)}%`}
          </span>
        </div>
      </div>
      {breakdown.length > 1 && (
        <p className="mt-1 text-[11px] font-mono text-ink-faint">
          {breakdown.map((item) => `${item.current} ${item.label}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

export default function TopMovers({ gainers, decliners }: { gainers: TopMover[]; decliners: TopMover[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div>
        <div className="flex items-center gap-2 mb-2 text-sage-deep">
          <TrendingUp className="w-4 h-4" />
          <span className="eyebrow text-ink-faint">Gaining</span>
        </div>
        {gainers.length > 0 ? (
          <div className="divide-y divide-line">
            {gainers.map((m) => <MoverRow key={m.category} mover={m} up />)}
          </div>
        ) : (
          <p className="text-sm text-ink-faint py-2">No notable gainers</p>
        )}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2 text-ember-deep">
          <TrendingDown className="w-4 h-4" />
          <span className="eyebrow text-ink-faint">Cooling</span>
        </div>
        {decliners.length > 0 ? (
          <div className="divide-y divide-line">
            {decliners.map((m) => <MoverRow key={m.category} mover={m} up={false} />)}
          </div>
        ) : (
          <p className="text-sm text-ink-faint py-2">No notable declines</p>
        )}
      </div>
    </div>
  );
}
