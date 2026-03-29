'use client';

import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { UserMetrics, AdvancedMetrics } from '@/types/mixpanel';

// Format session duration as Xm Ys
function formatDuration(duration: number) {
  const mins = Math.floor(duration / 60);
  const secs = Math.round(duration % 60);
  return `${mins}m ${secs}s`;
}

export default function EngagementPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: userMetrics, isLoading: isUsersLoading, isRefreshing: isUsersRefreshing, lastUpdated: usersLastUpdated } =
    useAnalytics<UserMetrics>('/api/metrics/users', { range: dateRange, platform, userType });

  const { data: advancedMetrics, isLoading: isAdvancedLoading, isRefreshing: isAdvancedRefreshing, lastUpdated: advancedLastUpdated } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', { range: dateRange, platform, userType });

  const isLoading = isUsersLoading || isAdvancedLoading;
  const isRefreshing = isUsersRefreshing || isAdvancedRefreshing;
  const lastUpdated = advancedLastUpdated || usersLastUpdated;

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || !userMetrics || !advancedMetrics) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, userMetrics, advancedMetrics]);

  // Prepare user breakdown data for PieChart (must be before any early returns)
  const userBreakdownData = useMemo(() => {
    if (!advancedMetrics) return [];
    return [
      { name: 'Paid', value: advancedMetrics.userBreakdown.paid },
      { name: 'Free', value: advancedMetrics.userBreakdown.free },
      { name: 'Guest', value: advancedMetrics.userBreakdown.guest },
    ];
  }, [advancedMetrics]);

  // Prepare feature adoption data for horizontal BarChart (must be before any early returns)
  const featureAdoptionData = useMemo(() => {
    if (!advancedMetrics) return [];
    return advancedMetrics.featureAdoption.map((f) => ({
      feature: f.feature,
      rate: Math.round((f.adoptionRate ?? 0) * 10) / 10,
    }));
  }, [advancedMetrics]);

  if (isLoading) {
    return <SkeletonPage statCards={3} statCardCols="grid-cols-1 md:grid-cols-3" chartCards={4} />;
  }

  if (!userMetrics || !advancedMetrics) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Engagement"
        subtitle="User activity, session depth, and feature adoption"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="DAU/MAU Ratio"
          value={advancedMetrics.dauMauRatio}
          format="ratio"
          subtitle="Stickiness"
        />
        <StatCard
          title="Avg Session Duration"
          value={formatDuration(advancedMetrics.avgSessionDuration)}
          format="text"
          subtitle="Time in app"
        />
        <StatCard
          title="Searches per User"
          value={advancedMetrics.searchesPerUser}
          format="decimal"
          subtitle="Avg per user"
        />
      </div>

      {/* DAU Trend — full width */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily Active Users" subtitle="DAU trend over selected period">
          <LineChart
            data={userMetrics.dau}
            xKey="date"
            lines={[{ key: 'users', color: '#10b981', name: 'Daily Active Users' }]}
          />
        </ChartCard>
      </div>

      {/* WAU + MAU — 2-col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Weekly Active Users" subtitle="Unique users per week">
          <BarChart data={userMetrics.wau} xKey="week" yKey="users" color="#34d399" />
        </ChartCard>
        <ChartCard title="Monthly Active Users" subtitle="Unique users per month">
          <BarChart data={userMetrics.mau} xKey="month" yKey="users" color="#059669" />
        </ChartCard>
      </div>

      {/* Session Duration Distribution + Sessions per User — 2-col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Session Duration Distribution" subtitle="How long users stay in the app">
          <BarChart data={userMetrics.sessionDurations} xKey="range" yKey="count" />
        </ChartCard>
        <ChartCard title="Sessions per User" subtitle="Number of sessions each user has">
          <BarChart data={userMetrics.sessionsPerUser} xKey="sessions" yKey="users" color="#10b981" />
        </ChartCard>
      </div>

      {/* User Breakdown + Feature Adoption — 2-col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="User Breakdown" subtitle="Paid vs Free vs Guest users">
          <PieChart
            data={userBreakdownData}
            colors={['#10b981', '#6366f1', '#71717a']}
          />
        </ChartCard>
        <ChartCard title="Feature Adoption Rates" subtitle="Percentage of users who used each feature">
          <BarChart
            data={featureAdoptionData}
            xKey="feature"
            yKey="rate"
            color="#8b5cf6"
            horizontal
          />
        </ChartCard>
      </div>
    </div>
  );
}
