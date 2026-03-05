'use client';

import { useMemo, useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';

interface SubscriberFunnel {
  funnel: { stage: string; count: number; rate: number }[];
  trialConversionRate: number;
  medianDaysToConvert: number;
  conversionByPlatform: Record<string, number>;
  weekOverWeek: { trialStarts: number; conversions: number };
  lastUpdated: string;
  note?: string;
}

export default function SubscriberFunnelPage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const daysMap: Record<string, string> = { '7d': '7', '30d': '30', '90d': '90' };
  const days = daysMap[dateRange] || '30';

  const { data: funnel, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<SubscriberFunnel>('/api/rc/subscriber-funnel', { days });

  // Funnel chart data
  const funnelData = useMemo(() =>
    (funnel?.funnel || []).map((step, index, arr) => ({
      name: step.stage,
      count: step.count,
      percentage: step.rate,
      dropoff: index > 0 ? arr[index - 1].rate - step.rate : 0,
    })),
    [funnel?.funnel]
  );

  // Conversion by platform chart data
  const platformConversionData = useMemo(() =>
    Object.entries(funnel?.conversionByPlatform || {}).map(([platform, rate]) => ({
      platform: platform.charAt(0).toUpperCase() + platform.slice(1),
      rate,
    })),
    [funnel?.conversionByPlatform]
  );

  useEffect(() => {
    if (!isLoading && funnel) {
      const ctx = gsap.context(() => {
        gsap.fromTo('.card-animate',
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, [isLoading, funnel]);

  if (isLoading) {
    return <SkeletonPage statCards={4} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-4" chartCards={2} />;
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 mb-4">{error}</div>
        <p className="text-zinc-500 text-sm">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
      </div>
    );
  }

  if (!funnel) {
    return (
      <div className="text-center font-mono text-zinc-500 py-20 tracking-wide uppercase">
        Failed to load funnel data. Please try again.
      </div>
    );
  }

  const wow = funnel.weekOverWeek || { trialStarts: 0, conversions: 0 };

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Subscriber Funnel"
        subtitle="Track user journey from signup to paid subscriber"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Warning banner */}
      {funnel.note && (
        <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{funnel.note}</span>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Trial → Paid Rate"
          value={funnel.trialConversionRate / 100}
          format="percentage"
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Median Days to Convert"
          value={funnel.medianDaysToConvert.toFixed(1)}
          format="text"
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Trial Starts WoW"
          value={wow.trialStarts}
          format="decimal"
          subtitle={wow.trialStarts >= 0 ? 'Up from last week' : 'Down from last week'}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          }
        />
        <StatCard
          title="Conversions WoW"
          value={wow.conversions}
          format="decimal"
          subtitle={wow.conversions >= 0 ? 'Up from last week' : 'Down from last week'}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Funnel Visualization */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Subscriber Funnel" subtitle={`Conversion funnel — last ${days} days`}>
          {funnelData.length > 0 ? (
            <FunnelChart data={funnelData} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No funnel data available yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Conversion by Platform */}
      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Conversion by Platform" subtitle="Trial-to-paid conversion rate per platform">
          {platformConversionData.length > 0 ? (
            <BarChart
              data={platformConversionData}
              xKey="platform"
              yKey="rate"
              color="#10b981"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No platform conversion data available yet
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
