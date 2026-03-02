'use client';

import { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import AreaChart from '@/components/charts/AreaChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { OverviewMetrics, UserBreakdown } from '@/types/mixpanel';

interface ExtendedOverviewMetrics extends OverviewMetrics {
  userBreakdown?: UserBreakdown;
}

export default function OverviewPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<ExtendedOverviewMetrics>(
    '/api/metrics/overview',
    { range: dateRange, platform, userType }
  );

  useEffect(() => {
    if (!isLoading && metrics) {
      const ctx = gsap.context(() => {
        gsap.fromTo('.card-animate',
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, [isLoading, metrics]);

  if (isLoading) {
    return <SkeletonPage statCards={5} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-5" chartCards={2} />;
  }

  if (!metrics) {
    return (
      <div className="text-center font-mono text-zinc-500 py-20 tracking-wide uppercase">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  // Helper to get the right label for the current filter
  const getUserTypeLabel = () => {
    switch (userType) {
      case 'authenticated': return 'Authenticated Users';
      case 'subscribers': return 'Subscribers';
      case 'visitors': return 'Visitors';
      default: return 'Total Users';
    }
  };

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Overview"
        subtitle="Key metrics and trends for Chunk AI"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* User Breakdown Cards - Always shows full breakdown regardless of filter */}
      {metrics.userBreakdown && userType === 'all' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1">
            <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Total Unique</p>
            <p className="text-3xl font-bold font-mono text-foreground mt-2 tracking-tight">{metrics.userBreakdown.total.toLocaleString()}</p>
          </div>
          <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1">
            <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Visitors (Anonymous)</p>
            <p className="text-3xl font-bold font-mono text-foreground mt-2 tracking-tight">{metrics.userBreakdown.visitors.toLocaleString()}</p>
            <p className="text-xs font-mono text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.visitors / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1">
            <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Authenticated</p>
            <p className="text-3xl font-bold font-mono text-foreground mt-2 tracking-tight">{metrics.userBreakdown.authenticated.toLocaleString()}</p>
            <p className="text-xs font-mono text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.authenticated / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1">
            <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Subscribers</p>
            <p className="text-3xl font-bold font-mono text-foreground mt-2 tracking-tight">{metrics.userBreakdown.subscribers.toLocaleString()}</p>
            <p className="text-xs font-mono text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.subscribers / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <StatCard
          title={getUserTypeLabel()}
          value={metrics.totalUsers}
          trend={metrics.usersTrend}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          title="Marketing Sessions"
          value={metrics.marketingSessions}
          trend={metrics.marketingSessionsTrend}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="App Sessions"
          value={metrics.appSessions}
          trend={metrics.appSessionsTrend}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Total Searches"
          value={metrics.totalSearches}
          trend={metrics.searchesTrend}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          }
        />
        <StatCard
          title="Conversion Rate"
          value={metrics.conversionRate}
          format="percentage"
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Daily Active Users" subtitle="Unique users per day">
          <AreaChart data={metrics.dailyData} xKey="date" yKey="users" color="#E63B2E" />
        </ChartCard>
        <ChartCard title="Daily Sessions" subtitle="Marketing vs App sessions per day">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'marketingSessions', color: '#111111', name: 'Marketing' },
              { key: 'appSessions', color: '#E63B2E', name: 'App' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Activity Overview" subtitle="Users, sessions, and searches over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'users', color: '#111111', name: 'Users' },
              { key: 'sessions', color: '#E63B2E', name: 'Sessions' },
              { key: 'searches', color: '#7ABAE1', name: 'Searches' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>
    </div>
  );
}
