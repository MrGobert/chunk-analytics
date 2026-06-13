'use client';

import Link from 'next/link';
import { CheckCircle2, ArrowRight, type LucideIcon } from 'lucide-react';

export interface AlertItem {
  id: string;
  level: 'critical' | 'warning';
  icon: LucideIcon;
  label: string;
  detail: string;
  href: string;
}

interface AlertStripProps {
  alerts: AlertItem[];
}

export default function AlertStrip({ alerts }: AlertStripProps) {
  if (alerts.length === 0) {
    return (
      <div className="mb-8 flex items-center gap-3 rounded-card border border-sage/30 bg-sage-tint/60 px-5 py-4">
        <CheckCircle2 className="w-5 h-5 text-sage-deep shrink-0" />
        <span className="text-sm font-medium text-ink">All clear — no churn, reliability, or billing alerts right now.</span>
      </div>
    );
  }

  return (
    <div className="mb-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {alerts.map((a) => {
        const Icon = a.icon;
        const critical = a.level === 'critical';
        return (
          <Link key={a.id} href={a.href} className="group">
            <div
              className={`flex items-center justify-between gap-3 rounded-card border px-5 py-4 transition-all duration-300 hover:-translate-y-0.5 ${
                critical
                  ? 'border-ember/30 bg-ember-tint/70'
                  : 'border-butter/50 bg-butter-tint/70'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-chip shrink-0 ${
                    critical ? 'bg-ember-tint text-ember-deep' : 'bg-butter-tint text-[#C8922A]'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{a.label}</p>
                  <p className="text-xs text-ink-soft truncate">{a.detail}</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-ink-faint group-hover:text-ink transition-colors shrink-0" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
