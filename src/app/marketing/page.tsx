'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import FunnelChart from '@/components/charts/FunnelChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { MarketingMetrics } from '@/types/mixpanel';

export default function MarketingPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<MarketingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/marketing?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch marketing metrics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
  }, [dateRange, platform, userType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-400 py-20">
        Failed to load marketing metrics. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Marketing & Conversion"
        subtitle="Track CTA engagement, feature page visits, and guest signup prompts"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Row 1 - Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total CTA Clicks"
          value={metrics.totalCTAClicks}
          trend={metrics.ctaClicksTrend}
          subtitle="Try Free + Create Account"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          }
        />
        <StatCard
          title="Feature Pages Visited"
          value={metrics.featurePagesVisited}
          trend={metrics.featurePagesTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Guest Signup Prompts"
          value={metrics.guestSignupPrompts}
          trend={metrics.guestPromptsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          }
        />
        <StatCard
          title="Paywall Dismissals"
          value={metrics.paywallDismissals}
          trend={metrics.paywallDismissalsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          }
        />
      </div>

      {/* Row 2 - Funnel + CTA Source Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Marketing CTA Funnel" subtitle="Sessions → CTA Click → Feature Pages → Guest Prompts">
          <FunnelChart data={metrics.marketingCTAFunnel} />
        </ChartCard>
        <ChartCard title="CTA Source Breakdown" subtitle="Where CTA clicks come from">
          {metrics.ctaSourceDistribution.length > 0 ? (
            <BarChart
              data={metrics.ctaSourceDistribution}
              xKey="source"
              yKey="count"
              horizontal
              color="#8b5cf6"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No CTA source data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 3 - Daily CTA Activity */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily CTA Clicks" subtitle="Try Free and Create Account clicks over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'tryFree', color: '#8b5cf6', name: 'Try For Free' },
              { key: 'createAccount', color: '#6366f1', name: 'Create Account' },
              { key: 'featurePages', color: '#3b82f6', name: 'Feature Pages' },
              { key: 'guestPrompts', color: '#14b8a6', name: 'Guest Prompts' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Row 4 - Feature Page Visits + Feature Limit Reached */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Feature Page Visits" subtitle="Which feature pages attract the most traffic">
          {metrics.featurePageDistribution.length > 0 ? (
            <BarChart
              data={metrics.featurePageDistribution}
              xKey="page"
              yKey="count"
              horizontal
              color="#3b82f6"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No feature page data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Feature Limit Reached" subtitle="Which features trigger the paywall">
          {metrics.featureLimitDistribution.length > 0 ? (
            <BarChart
              data={metrics.featureLimitDistribution}
              xKey="feature"
              yKey="count"
              horizontal
              color="#ef4444"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No feature limit data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5 - Bottom Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Try For Free Clicks"
          value={metrics.tryForFreeClicks}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Create Account Clicks"
          value={metrics.createAccountClicks}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          }
        />
        <StatCard
          title="Feature Limits Hit"
          value={metrics.featureLimitReached}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <StatCard
          title="Marketing Sessions"
          value={metrics.marketingSessions}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
