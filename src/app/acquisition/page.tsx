'use client';

import { useState } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import FunnelChart from '@/components/charts/FunnelChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { AcquisitionFunnelMetrics } from '@/types/mixpanel';

const PLATFORM_TABS = [
  {
    key: 'web',
    label: 'Web',
    description: 'Marketing site',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
    ),
  },
  {
    key: 'ios',
    label: 'iOS',
    description: 'iPhone / iPad / Vision Pro',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
  },
  {
    key: 'macOS',
    label: 'macOS',
    description: 'No onboarding',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
] as const;

type PlatformKey = (typeof PLATFORM_TABS)[number]['key'];

export default function AcquisitionPage() {
  const { dateRange, setDateRange, userType, setUserType } = useDashboardFilters();
  const [platformGroup, setPlatformGroup] = useState<PlatformKey>('web');

  // Cap at 7d — Mixpanel export API is too slow for larger ranges on cold cache
  const effectiveRange = ['30d', '90d', '365d'].includes(dateRange) ? '7d' : dateRange;

  const { data: metrics, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<AcquisitionFunnelMetrics>('/api/metrics/acquisition', {
      range: effectiveRange,
      platform: platformGroup,
      userType,
    });

  if (isLoading) {
    return <SkeletonPage statCards={4} chartCards={2} />;
  }

  if (!metrics) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500 mb-2">Failed to load acquisition metrics.</p>
        {error && (
          <p className="text-xs font-mono text-red-400/70">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Acquisition Funnel"
        subtitle="Conversion pipeline by platform"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-8">
        {PLATFORM_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPlatformGroup(tab.key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
              platformGroup === tab.key
                ? 'bg-accent text-white shadow-lg shadow-accent/20'
                : 'bg-primary text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {tab.icon}
            <div className="text-left">
              <div className="leading-tight">{tab.label}</div>
              <div
                className={`text-[10px] leading-tight ${
                  platformGroup === tab.key ? 'text-white/70' : 'text-zinc-600'
                }`}
              >
                {tab.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Conversion Rate Cards — fixed grid (always 4 cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.statCards.map((card) => (
          <StatCard
            key={card.label}
            title={card.label}
            value={card.value}
            format="percentage"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            }
          />
        ))}
      </div>

      {/* Funnel Visualization */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title={`${PLATFORM_TABS.find((t) => t.key === platformGroup)?.label} Acquisition Funnel`}
          subtitle={metrics.subtitle}
        >
          {metrics.funnel.some((s) => s.count > 0) ? (
            <FunnelChart data={metrics.funnel} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
              No funnel data for this platform and time range
            </div>
          )}
        </ChartCard>
      </div>

      {/* Daily Breakdown */}
      <div className="grid grid-cols-1 gap-6">
        <ChartCard
          title="Daily Funnel Activity"
          subtitle="Unique users per funnel stage per day"
        >
          {metrics.dailyData.length > 0 ? (
            <LineChart
              data={metrics.dailyData}
              xKey="date"
              lines={metrics.dailyLines}
              showLegend
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
              No daily data available
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
