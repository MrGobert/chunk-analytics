'use client';

import { useEffect, useRef } from 'react';
import { useStoredState, useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import CohortHeatmap from '@/components/charts/CohortHeatmap';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { RetentionCohortMetrics, AdvancedMetrics, FeatureOverviewMetrics } from '@/types/mixpanel';
import { chart } from '@/lib/chartTheme';

const WEEK_OPTIONS = [6, 8, 12];

function WeeksSelector({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-card border border-line p-1 shadow-card">
      {WEEK_OPTIONS.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${
            value === w ? 'bg-ember-deep text-[#FFF8F2]' : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
          }`}
        >
          {w} weeks
        </button>
      ))}
    </div>
  );
}

export default function RetentionPage() {
  const { platform } = useDashboardFilters();
  const [weeks, setWeeks] = useStoredState('retention_weeks', 8);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isRefreshing, lastUpdated, error } =
    useAnalytics<RetentionCohortMetrics>('/api/metrics/retention-cohorts', { weeks: String(weeks), platform });
  const { data: advanced } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', { range: '30d', platform: 'all', userType: 'all' });
  const { data: features } =
    useAnalytics<FeatureOverviewMetrics>('/api/metrics/feature-overview', { range: '30d', platform: 'all', userType: 'all' });

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

  const stickinessBars = (features?.features || [])
    .filter((f) => typeof f.stickiness === 'number')
    .map((f) => ({ name: f.name, stickiness: Math.round((f.stickiness as number) * 1000) / 10 }))
    .sort((a, b) => b.stickiness - a.stickiness);

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Retention"
        subtitle="Weekly signup cohorts and how sticky the product is"
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        controls={<WeeksSelector value={weeks} onChange={setWeeks} />}
      />

      {/* Retention stat cards from advanced */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card-animate"><StatCard title="DAU / MAU" value={advanced?.dauMauRatio ?? 0} format="ratio" subtitle="Stickiness" /></div>
        <div className="card-animate"><StatCard title="Day 1 Retention" value={(advanced?.retention?.day1 ?? 0) / 100} format="percentage" subtitle="Return next day" /></div>
        <div className="card-animate"><StatCard title="Day 7 Retention" value={(advanced?.retention?.day7 ?? 0) / 100} format="percentage" subtitle="Return within a week" /></div>
        <div className="card-animate"><StatCard title="Day 30 Retention" value={(advanced?.retention?.day30 ?? 0) / 100} format="percentage" subtitle="Return within a month" /></div>
      </div>

      {isLoading ? (
        <SkeletonPage statCards={0} chartCards={2} />
      ) : error || !data ? (
        <div className="empty-state py-20">{error || 'Failed to load retention data.'}</div>
      ) : (
        <>
          {/* Cohort heatmap */}
          <div className="card-animate card-surface p-6 sm:p-8 mb-8">
            <div className="mb-6 border-b border-line pb-4">
              <h3 className="font-display text-xl sm:text-2xl text-ink">Weekly Cohort Retention</h3>
              <p className="text-sm font-mono text-ink-faint mt-2">{data.totalSignups} signups · {data.cohorts.length} weekly cohorts</p>
            </div>
            <CohortHeatmap cohorts={data.cohorts} weeks={data.weeks} />
          </div>

          {/* Retention curve + feature stickiness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-animate">
              <ChartCard title="Average Retention Curve" subtitle="Size-weighted across all cohorts">
                <LineChart
                  data={data.curve.map((c) => ({ week: `W${c.week}`, retention: c.retention }))}
                  xKey="week"
                  lines={[{ key: 'retention', color: chart.lake, name: 'Retention %' }]}
                />
              </ChartCard>
            </div>
            <div className="card-animate">
              <ChartCard title="Feature Stickiness" subtitle="DAU/MAU per feature — daily habits">
                {stickinessBars.length > 0 ? (
                  <BarChart data={stickinessBars} xKey="name" yKey="stickiness" horizontal color={chart.series[1]} />
                ) : (
                  <div className="empty-state h-full">Stickiness data loading…</div>
                )}
              </ChartCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
