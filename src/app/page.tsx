'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import AreaChart from '@/components/charts/AreaChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { OverviewMetrics, UserBreakdown } from '@/types/mixpanel';

interface ExtendedOverviewMetrics extends OverviewMetrics {
  userBreakdown?: UserBreakdown;
}

export default function OverviewPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<ExtendedOverviewMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/overview?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
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
    <div>
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
      />

      {/* User Breakdown Cards - Always shows full breakdown regardless of filter */}
      {metrics.userBreakdown && userType === 'all' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Total Unique</p>
            <p className="text-2xl font-bold text-white mt-1">{metrics.userBreakdown.total.toLocaleString()}</p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Visitors (Anonymous)</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{metrics.userBreakdown.visitors.toLocaleString()}</p>
            <p className="text-xs text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.visitors / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Authenticated</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{metrics.userBreakdown.authenticated.toLocaleString()}</p>
            <p className="text-xs text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.authenticated / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Subscribers</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{metrics.userBreakdown.subscribers.toLocaleString()}</p>
            <p className="text-xs text-zinc-500 mt-1">
              {metrics.userBreakdown.total > 0 ? ((metrics.userBreakdown.subscribers / metrics.userBreakdown.total) * 100).toFixed(1) : 0}%
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title={getUserTypeLabel()}
          value={metrics.totalUsers}
          trend={metrics.usersTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          title="Total Sessions"
          value={metrics.totalSessions}
          trend={metrics.sessionsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Total Searches"
          value={metrics.totalSearches}
          trend={metrics.searchesTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          }
        />
        <StatCard
          title="Conversion Rate"
          value={metrics.conversionRate}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Daily Active Users" subtitle="Unique users per day">
          <AreaChart data={metrics.dailyData} xKey="date" yKey="users" color="#8b5cf6" />
        </ChartCard>
        <ChartCard title="Daily Sessions" subtitle="Session count per day">
          <AreaChart data={metrics.dailyData} xKey="date" yKey="sessions" color="#6366f1" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Activity Overview" subtitle="Users, sessions, and searches over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'users', color: '#8b5cf6', name: 'Users' },
              { key: 'sessions', color: '#6366f1', name: 'Sessions' },
              { key: 'searches', color: '#3b82f6', name: 'Searches' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>
    </div>
  );
}
