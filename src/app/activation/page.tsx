'use client';

import { useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import LineChart from '@/components/charts/LineChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { ActivationMetrics } from '@/types/mixpanel';
import { chart } from '@/lib/chartTheme';
import { Zap, Clock, Target, Flag } from 'lucide-react';

export default function ActivationPage() {
  const { dateRange, setDateRange, platform, setPlatform } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isRefreshing, lastUpdated, error } =
    useAnalytics<ActivationMetrics>('/api/metrics/activation', { range: dateRange, platform });

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || !data) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, data]);

  if (isLoading) {
    return <SkeletonPage statCards={4} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-4" chartCards={3} />;
  }
  if (error || !data) {
    return <div className="empty-state py-20">{error || 'Failed to load activation data.'}</div>;
  }

  const median = data.medianMinutesToFirstAction;
  const medianLabel = median == null ? '—' : median < 60 ? `${median}m` : `${(median / 60).toFixed(1)}h`;
  const platformBars = data.byPlatform.map((p) => ({ name: p.name, rate: Math.round(p.rate * 10) / 10 }));

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Activation"
        subtitle="Do new signups reach first value within 24 hours?"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card-animate"><StatCard title="Activation Rate" value={data.activationRate} format="percentage" icon={<Zap className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Eligible Signups" value={data.eligibleSignups} subtitle="≥24h of observable window" icon={<Flag className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Activated" value={data.activatedCount} subtitle="≥1 key action in 24h" icon={<Target className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Median Time to First Action" value={medianLabel} format="text" icon={<Clock className="w-5 h-5" />} /></div>
      </div>

      {/* Funnel + first-action mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Activation Funnel" subtitle="Signup → first action → second action → next-day return">
            <FunnelChart data={data.funnel} />
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="First Action" subtitle="What activated users did first">
            {data.firstActionMix.length > 0 ? (
              <PieChart data={data.firstActionMix} />
            ) : (
              <div className="empty-state h-full">No activated users yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Time-to-first-action + by platform */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Time to First Action" subtitle="How fast new users reach value">
            <BarChart data={data.timeToFirstAction} xKey="bucket" yKey="count" color={chart.series[0]} />
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Activation by Platform" subtitle="Where new users activate best, %">
            {platformBars.length > 0 ? (
              <BarChart data={platformBars} xKey="name" yKey="rate" horizontal color={chart.series[1]} />
            ) : (
              <div className="empty-state h-full">No platform data</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Onboarding impact + weekly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-animate card-surface p-6 sm:p-8">
          <h3 className="font-display text-xl text-ink mb-1">Onboarding Impact</h3>
          <p className="text-sm font-mono text-ink-faint mb-5">Activation by onboarding outcome</p>
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-ink-soft">Completed onboarding</span>
                <span className="font-mono text-ink tabular-nums">{data.onboarding.completed.rate.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-paper-deep overflow-hidden">
                <div className="h-full rounded-full bg-sage" style={{ width: `${Math.min(100, data.onboarding.completed.rate)}%` }} />
              </div>
              <p className="text-xs text-ink-faint mt-1 font-mono">{data.onboarding.completed.signups} signups</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-ink-soft">Skipped onboarding</span>
                <span className="font-mono text-ink tabular-nums">{data.onboarding.skipped.rate.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-paper-deep overflow-hidden">
                <div className="h-full rounded-full bg-butter" style={{ width: `${Math.min(100, data.onboarding.skipped.rate)}%` }} />
              </div>
              <p className="text-xs text-ink-faint mt-1 font-mono">{data.onboarding.skipped.signups} signups</p>
            </div>
          </div>
        </div>

        <div className="card-animate lg:col-span-2">
          <ChartCard title="Weekly Activation Trend" subtitle="Activation rate by signup week">
            {data.weeklyTrend.length > 0 ? (
              <LineChart data={data.weeklyTrend} xKey="week" lines={[{ key: 'rate', color: chart.primary, name: 'Activation %' }]} />
            ) : (
              <div className="empty-state h-full">Not enough weekly data</div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
