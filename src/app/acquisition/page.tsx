'use client';

import { useState } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { AcquisitionFunnelMetrics, MarketingMetrics, AdvancedMetrics } from '@/types/mixpanel';

// ─── Platform tabs ──────────────────────────────────────────────────────────

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
  const { userType, setUserType } = useDashboardFilters();
  const [dateRange, setDateRange] = useState('7d');
  const [platformGroup, setPlatformGroup] = useState<PlatformKey>('web');

  const { data: metrics, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<AcquisitionFunnelMetrics>('/api/metrics/acquisition', {
      range: dateRange,
      platform: platformGroup,
      userType,
    });

  const { data: marketing, isLoading: marketingLoading } =
    useAnalytics<MarketingMetrics>('/api/metrics/marketing', {
      range: dateRange,
      platform: 'all',
      userType: 'all',
    });

  const { data: advanced, isLoading: advancedLoading } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', {
      range: dateRange,
      platform: 'all',
      userType: 'all',
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

      {/* ─── Web Onboarding ─────────────────────────────────────────────── */}
      {metrics.webOnboarding && (
        <>
          <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
            <h2 className="text-xl font-bold text-foreground tracking-tight">First-Run Onboarding</h2>
            <p className="text-sm text-zinc-500 mt-1">How new users engage with the onboarding flow</p>
          </div>

          {/* Onboarding Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              title="Onboarding Started"
              value={metrics.webOnboarding.started}
              format="number"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              title="Completion Rate"
              value={metrics.webOnboarding.completionRate}
              format="percentage"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              title="Skip Rate"
              value={metrics.webOnboarding.skipRate}
              format="percentage"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              }
            />
            <StatCard
              title="Avg. Completion Time"
              value={metrics.webOnboarding.avgCompletionTime != null
                ? `${metrics.webOnboarding.avgCompletionTime}s`
                : '—'}
              format="text"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </div>

          {/* Intent Distribution + Skip Step Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="User Intent Selection"
              subtitle="What users chose in onboarding step 1"
            >
              {metrics.webOnboarding.intentDistribution.length > 0 ? (
                <BarChart
                  data={metrics.webOnboarding.intentDistribution.map((d) => ({
                    ...d,
                    intent: d.intent.charAt(0).toUpperCase() + d.intent.slice(1),
                  }))}
                  xKey="intent"
                  yKey="count"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No intent data yet
                </div>
              )}
            </ChartCard>
            <ChartCard
              title="Skip Step Distribution"
              subtitle="Where users bail out of onboarding"
            >
              {metrics.webOnboarding.skipStepDistribution.length > 0 ? (
                <BarChart
                  data={metrics.webOnboarding.skipStepDistribution}
                  xKey="step"
                  yKey="count"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No skip data yet
                </div>
              )}
            </ChartCard>
          </div>

          {/* Step Completion Funnel */}
          <div className="grid grid-cols-1 gap-6 mt-6">
            <ChartCard
              title="Step-by-Step Progression"
              subtitle="How users progress through each onboarding step"
            >
              {metrics.webOnboarding.stepCompletionFunnel.some((s) => s.count > 0) ? (
                <FunnelChart data={metrics.webOnboarding.stepCompletionFunnel} />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No step completion data yet
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* ─── Marketing & Conversion ──────────────────────────────────────── */}
      {marketing && (
        <>
          <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
            <h2 className="text-xl font-bold text-foreground tracking-tight">Marketing & Conversion</h2>
            <p className="text-sm text-zinc-500 mt-1">CTA performance and conversion triggers</p>
          </div>

          {/* Marketing Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              title="CTA Clicks"
              value={marketing.totalCTAClicks}
              trend={marketing.ctaClicksTrend}
              format="number"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
              }
            />
            <StatCard
              title="Feature Page Visits"
              value={marketing.featurePagesVisited}
              trend={marketing.featurePagesTrend}
              format="number"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              }
            />
            <StatCard
              title="Guest Prompts"
              value={marketing.guestSignupPrompts}
              trend={marketing.guestPromptsTrend}
              format="number"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              }
            />
            <StatCard
              title="Feature Limits Hit"
              value={marketing.featureLimitReached}
              format="number"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
          </div>

          {/* Marketing Charts — CTA Source + Feature Limit Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="CTA Source Distribution"
              subtitle="Where CTA clicks originate"
            >
              {marketing.ctaSourceDistribution.length > 0 ? (
                <BarChart
                  data={marketing.ctaSourceDistribution}
                  xKey="source"
                  yKey="count"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No CTA source data available
                </div>
              )}
            </ChartCard>
            <ChartCard
              title="Feature Limit Distribution"
              subtitle="Which features trigger limit prompts"
            >
              {marketing.featureLimitDistribution.length > 0 ? (
                <BarChart
                  data={marketing.featureLimitDistribution}
                  xKey="feature"
                  yKey="count"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No feature limit data available
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* Marketing loading skeleton */}
      {!marketing && marketingLoading && (
        <>
          <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
            <h2 className="text-xl font-bold text-foreground tracking-tight">Marketing & Conversion</h2>
            <p className="text-sm text-zinc-500 mt-1">CTA performance and conversion triggers</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonChartCard />
            <SkeletonChartCard />
          </div>
        </>
      )}

      {/* ─── Traffic Sources ─────────────────────────────────────────────── */}
      {advanced && (
        <>
          <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
            <h2 className="text-xl font-bold text-foreground tracking-tight">Traffic Sources</h2>
            <p className="text-sm text-zinc-500 mt-1">Where users come from</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="Referrer Domains"
              subtitle="Top traffic sources by session count"
            >
              {advanced.trafficSources.length > 0 ? (
                <DataTable
                  data={advanced.trafficSources as { source: string; sessions: number }[]}
                  columns={[
                    { key: 'source', header: 'Source' },
                    { key: 'sessions', header: 'Sessions' },
                  ]}
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No referrer data available
                </div>
              )}
            </ChartCard>
            <ChartCard
              title="UTM Campaigns"
              subtitle="Campaign performance by sessions"
            >
              {advanced.utmSources.length > 0 ? (
                <DataTable
                  data={advanced.utmSources as { campaign: string; sessions: number }[]}
                  columns={[
                    { key: 'campaign', header: 'Campaign' },
                    { key: 'sessions', header: 'Sessions' },
                  ]}
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
                  No UTM campaign data available
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* Traffic sources loading skeleton */}
      {!advanced && advancedLoading && (
        <>
          <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
            <h2 className="text-xl font-bold text-foreground tracking-tight">Traffic Sources</h2>
            <p className="text-sm text-zinc-500 mt-1">Where users come from</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonChartCard />
            <SkeletonChartCard />
          </div>
        </>
      )}
    </div>
  );
}
