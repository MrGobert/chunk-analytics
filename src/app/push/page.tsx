'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import AreaChart from '@/components/charts/AreaChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import FunnelChart from '@/components/charts/FunnelChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface PushMetrics {
  permissionRequested: number;
  permissionGranted: number;
  permissionDenied: number;
  notificationsOpened: number;
  optInRate: number;
  usersWithOpens: number;
  requestedTrend: number | null;
  grantedTrend: number | null;
  openedTrend: number | null;
  dailyData: Array<{
    date: string;
    requested: number;
    granted: number;
    denied: number;
    opened: number;
  }>;
  destinations: Array<{ destination: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  permissionFunnel: Array<{ name: string; count: number; percentage: number; dropoff: number }>;
  hourlyDistribution: Array<{ hour: number; count: number }>;
  lastUpdated: string;
}

export default function PushNotificationsPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<PushMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/push?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch push metrics:', error);
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
        Failed to load push notification metrics. Please try again.
      </div>
    );
  }

  // Format hourly data for chart
  const hourlyData = metrics.hourlyDistribution.map((h) => ({
    hour: `${h.hour.toString().padStart(2, '0')}:00`,
    opens: h.count,
  }));

  // Format destinations for pie chart
  const destinationData = metrics.destinations.slice(0, 8).map((d) => ({
    name: d.destination || 'Unknown',
    value: d.count,
  }));

  // Calculate total opens for percentage display
  const totalOpens = metrics.destinations.reduce((acc, d) => acc + d.count, 0);

  return (
    <div>
      <PageHeader
        title="Push Notifications"
        subtitle="Track push notification permissions, engagement, and deep link destinations"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Permission Requests"
          value={metrics.permissionRequested}
          trend={metrics.requestedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          }
        />
        <StatCard
          title="Permissions Granted"
          value={metrics.permissionGranted}
          trend={metrics.grantedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Opt-In Rate"
          value={metrics.optInRate}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Notifications Opened"
          value={metrics.notificationsOpened}
          trend={metrics.openedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
      </div>

      {/* Permission Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Permission Funnel" subtitle="From request to engagement">
          <FunnelChart data={metrics.permissionFunnel} />
        </ChartCard>
        <ChartCard title="Deep Link Destinations" subtitle="Where users navigate from push notifications">
          {destinationData.length > 0 ? (
            <PieChart data={destinationData} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No notification opens recorded yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Daily Trends */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily Push Activity" subtitle="Permission requests and notification opens over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'requested', color: '#8b5cf6', name: 'Requested' },
              { key: 'granted', color: '#22c55e', name: 'Granted' },
              { key: 'denied', color: '#ef4444', name: 'Denied' },
              { key: 'opened', color: '#3b82f6', name: 'Opened' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Hourly Opens & Destinations Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Opens by Hour" subtitle="When users engage with notifications">
          <AreaChart data={hourlyData} xKey="hour" yKey="opens" color="#8b5cf6" />
        </ChartCard>
        <ChartCard title="Destination Breakdown" subtitle="Click destinations from push notifications">
          <DataTable
            columns={[
              { key: 'destination', header: 'Destination' },
              { key: 'count', header: 'Opens' },
              { key: 'percentage', header: '% of Total' },
            ]}
            data={metrics.destinations.map((d) => ({
              destination: d.destination || 'Unknown',
              count: d.count,
              percentage: totalOpens > 0 ? `${((d.count / totalOpens) * 100).toFixed(1)}%` : '0%',
            }))}
          />
        </ChartCard>
      </div>

      {/* Permission Sources */}
      {metrics.sources.length > 0 && (
        <div className="grid grid-cols-1 gap-6">
          <ChartCard title="Permission Request Sources" subtitle="Where permission prompts are triggered">
            <DataTable
              columns={[
                { key: 'source', header: 'Source' },
                { key: 'count', header: 'Requests' },
                { key: 'percentage', header: '% of Total' },
              ]}
              data={metrics.sources.map((s) => ({
                source: s.source || 'Unknown',
                count: s.count,
                percentage: metrics.permissionRequested > 0 
                  ? `${((s.count / metrics.permissionRequested) * 100).toFixed(1)}%` 
                  : '0%',
              }))}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
