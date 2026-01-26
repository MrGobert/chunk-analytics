'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { UserMetrics } from '@/types/mixpanel';

export default function UsersPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/users?range=${dateRange}&platform=${platform}`);
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
  }, [dateRange, platform]);

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

  return (
    <div>
      <PageHeader
        title="User Activity"
        subtitle="User engagement and activity metrics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <ChartCard title="Daily Active Users (DAU)" subtitle="Unique users per day">
          <LineChart
            data={metrics.dau}
            xKey="date"
            lines={[{ key: 'users', color: '#8b5cf6', name: 'DAU' }]}
          />
        </ChartCard>
        <ChartCard title="Weekly Active Users (WAU)" subtitle="Unique users per week">
          <BarChart data={metrics.wau} xKey="week" yKey="users" color="#6366f1" />
        </ChartCard>
        <ChartCard title="Monthly Active Users (MAU)" subtitle="Unique users per month">
          <BarChart data={metrics.mau} xKey="month" yKey="users" color="#3b82f6" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Session Duration Distribution" subtitle="How long users stay in the app">
          <BarChart data={metrics.sessionDurations} xKey="range" yKey="count" />
        </ChartCard>
        <ChartCard title="Sessions per User" subtitle="Number of sessions each user has">
          <BarChart data={metrics.sessionsPerUser} xKey="sessions" yKey="users" color="#14b8a6" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Geographic Distribution" subtitle="Users by country">
          <DataTable
            data={metrics.geographic}
            columns={[
              { key: 'country', header: 'Country' },
              { key: 'users', header: 'Events' },
              {
                key: 'percentage',
                header: 'Share',
                render: (value) => `${Number(value).toFixed(1)}%`,
              },
            ]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
