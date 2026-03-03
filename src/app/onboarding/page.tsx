'use client';

import { useState } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';

interface OnboardingMetrics {
  funnel: { name: string; count: number; percentage: number; dropoff: number }[];
  funnelLabel: string;
  signupsOverTime: { date: string; count: number }[];
  firstOpenToSignup: { day: string; count: number }[];
  totalFirstStep: number;
  totalSignups: number;
  conversionRate: number;
  lastUpdated: string;
}

const PLATFORM_TABS = [
  { key: 'mobile', label: 'Mobile', description: 'iOS / iPadOS / visionOS' },
  { key: 'macOS', label: 'macOS', description: 'No onboarding flow' },
  { key: 'web', label: 'Web', description: 'Marketing site' },
] as const;

export default function OnboardingPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();
  const [platformGroup, setPlatformGroup] = useState<string>('mobile');


  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<OnboardingMetrics>(
    '/api/metrics/onboarding',
    { range: dateRange, platform: platformGroup, userType }
  );

  if (isLoading) {
    return <SkeletonPage statCards={3} statCardCols="grid-cols-1 md:grid-cols-3" chartCards={2} />;
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  const firstStepLabel = platformGroup === 'web' ? 'Site Visitors' : 'First Opens';

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Onboarding"
        subtitle="User acquisition and onboarding funnel"
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
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${platformGroup === tab.key
                ? 'bg-violet-600 text-foreground'
                : 'bg-primary text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
          >
            <div>{tab.label}</div>
            <div className={`text-xs ${platformGroup === tab.key ? 'text-violet-200' : 'text-zinc-500'}`}>
              {tab.description}
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title={firstStepLabel} value={metrics.totalFirstStep} />
        <StatCard title="Sign Ups" value={metrics.totalSignups} subtitle="Unique users" />
        <StatCard title="Conversion Rate" value={metrics.conversionRate} format="percentage" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Onboarding Funnel"
          subtitle={metrics.funnelLabel}
          className="h-auto"
        >
          <FunnelChart data={metrics.funnel} />
        </ChartCard>
      </div>

      <div className={`grid grid-cols-1 ${metrics.firstOpenToSignup.length > 0 ? 'lg:grid-cols-2' : ''} gap-6 mb-8`}>
        <ChartCard title="Sign Ups Over Time" subtitle="Daily unique new registrations">
          <AreaChart
            data={metrics.signupsOverTime}
            xKey="date"
            yKey="count"
            color="#22c55e"
          />
        </ChartCard>
        {metrics.firstOpenToSignup.length > 0 && (
          <ChartCard title="Time to Signup" subtitle="Days from first open to signup">
            <BarChart data={metrics.firstOpenToSignup} xKey="day" yKey="count" color="#6366f1" />
          </ChartCard>
        )}
      </div>
    </div>
  );
}
