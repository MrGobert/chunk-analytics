'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

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
  const [dateRange, setDateRange] = useState('30d');
  const [platformGroup, setPlatformGroup] = useState<string>('mobile');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<OnboardingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/metrics/onboarding?range=${dateRange}&platform=${platformGroup}&userType=${userType}`
        );
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch onboarding metrics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
  }, [dateRange, platformGroup, userType]);

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
        Failed to load metrics. Please try again.
      </div>
    );
  }

  const firstStepLabel = platformGroup === 'web' ? 'Site Visitors' : 'First Opens';

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle="User acquisition and onboarding funnel"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-8">
        {PLATFORM_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPlatformGroup(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              platformGroup === tab.key
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
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
