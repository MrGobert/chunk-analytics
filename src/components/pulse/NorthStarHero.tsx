'use client';

import { Sparkles } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { chart } from '@/lib/chartTheme';
import { formatNumber } from '@/lib/utils';

interface NorthStarHeroProps {
  value: number;
  change: number | null;
  trend: { date: string; users: number }[];
}

export default function NorthStarHero({ value, change, trend }: NorthStarHeroProps) {
  const isNew = change === null;
  const up = (change ?? 0) >= 0;

  return (
    <div className="card-surface p-6 sm:p-8 relative overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-chip bg-ember-tint text-ember-deep">
          <Sparkles className="w-4 h-4" />
        </div>
        <span className="eyebrow text-ember-deep">North Star · Weekly Active Creators</span>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <span className="font-mono text-5xl sm:text-6xl font-medium text-ink tabular-nums leading-none">
          {formatNumber(value)}
        </span>
        {!isNew && (
          <span
            className={`mb-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-mono font-medium border ${
              up ? 'bg-sage-tint text-sage-deep border-sage/30' : 'bg-ember-tint text-ember-deep border-ember/30'
            }`}
          >
            {up ? '↑' : '↓'} {Math.abs(change ?? 0).toFixed(1)}% WoW
          </span>
        )}
        {isNew && (
          <span className="sticker mb-1 !py-0.5 bg-butter-tint border-butter/50 text-ink-soft">New</span>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-soft max-w-md">
        Unique people who searched, took notes, created an artifact, ran research, or built a
        collection in the last 7 days — the heartbeat of the product.
      </p>

      {/* Activity sparkline (14-day DAU) */}
      <div className="mt-6 h-16 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="northStarSpark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chart.primary} stopOpacity={0.18} />
                <stop offset="95%" stopColor={chart.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="users"
              stroke={chart.primary}
              strokeWidth={2}
              fill="url(#northStarSpark)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs font-mono text-ink-faint">Daily active users · 14 days</p>
    </div>
  );
}
