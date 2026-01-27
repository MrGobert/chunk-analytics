'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface RetentionData {
  day1: number;
  day7: number;
  day30: number;
  totalNewUsers: number;
}

interface UserBreakdown {
  total: number;
  paid: number;
  free: number;
  paidPercentage: number;
  guest: number;
  authenticated: number;
}

interface TrafficSource {
  source: string;
  count: number;
}

interface FeatureAdoption {
  feature: string;
  users: number;
  adoptionRate: number;
}

interface AdvancedMetrics {
  dauMauRatio: number;
  avgDAU: number;
  mau: number;
  avgSessionDuration: number;
  searchesPerUser: number;
  retention: RetentionData;
  userBreakdown: UserBreakdown;
  trafficSources: TrafficSource[];
  utmSources: TrafficSource[];
  featureAdoption: FeatureAdoption[];
  lastUpdated: string;
}

export default function InsightsPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [metrics, setMetrics] = useState<AdvancedMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/advanced?range=${dateRange}&platform=${platform}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch advanced metrics:', error);
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

  // Format session duration
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  // Prepare data for charts
  const retentionData = [
    { name: 'Day 1', value: metrics.retention.day1 },
    { name: 'Day 7', value: metrics.retention.day7 },
    { name: 'Day 30', value: metrics.retention.day30 },
  ];

  const featureAdoptionData = metrics.featureAdoption.map((f) => ({
    name: f.feature,
    value: f.adoptionRate,
    users: f.users,
  }));

  return (
    <div>
      <PageHeader
        title="Business Insights"
        subtitle="Retention, engagement, and growth metrics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
      />

      {/* Key Engagement Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <StatCard
          title="DAU/MAU Ratio"
          value={metrics.dauMauRatio}
          format="ratio"
          subtitle="Stickiness"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Avg DAU"
          value={metrics.avgDAU}
          subtitle="Daily Active Users"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          title="MAU"
          value={metrics.mau}
          subtitle="Monthly Active Users"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />
        <StatCard
          title="Avg Session"
          value={formatDuration(metrics.avgSessionDuration)}
          subtitle="Session Duration"
          format="text"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Searches/User"
          value={metrics.searchesPerUser}
          format="decimal"
          subtitle="Avg searches per user"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          }
        />
      </div>

      {/* Retention & User Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard 
          title="User Retention" 
          subtitle={`Based on ${metrics.retention.totalNewUsers} new users`}
        >
          <div className="space-y-4">
            {retentionData.map((item) => (
              <div key={item.name} className="flex items-center gap-4">
                <div className="w-20 text-sm text-zinc-400">{item.name}</div>
                <div className="flex-1 bg-zinc-800 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(item.value, 100)}%` }}
                  />
                </div>
                <div className="w-16 text-right text-sm font-medium text-white">
                  {item.value.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Percentage of new users who return on each day
          </p>
        </ChartCard>

        <ChartCard title="User Breakdown" subtitle="Free vs Paid users">
          <div className="flex flex-col items-center">
            {/* Custom SVG Donut Chart */}
            <div className="relative mb-6">
              <svg width="180" height="180" viewBox="0 0 180 180">
                {(() => {
                  const total = metrics.userBreakdown.free + metrics.userBreakdown.paid;
                  const freePercent = total > 0 ? metrics.userBreakdown.free / total : 0;
                  const paidPercent = total > 0 ? metrics.userBreakdown.paid / total : 0;
                  const radius = 70;
                  const strokeWidth = 24;
                  const circumference = 2 * Math.PI * radius;
                  const freeLength = circumference * freePercent;
                  const paidLength = circumference * paidPercent;
                  const center = 90;
                  
                  return (
                    <>
                      {/* Background circle */}
                      <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="none"
                        stroke="#27272a"
                        strokeWidth={strokeWidth}
                      />
                      {/* Free users arc (indigo) */}
                      <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${freeLength} ${circumference}`}
                        strokeDashoffset={0}
                        transform={`rotate(-90 ${center} ${center})`}
                        strokeLinecap="round"
                      />
                      {/* Paid users arc (emerald) */}
                      <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${paidLength} ${circumference}`}
                        strokeDashoffset={-freeLength}
                        transform={`rotate(-90 ${center} ${center})`}
                        strokeLinecap="round"
                      />
                      {/* Center text */}
                      <text
                        x={center}
                        y={center - 8}
                        textAnchor="middle"
                        className="fill-white text-2xl font-bold"
                        style={{ fontSize: '24px', fontWeight: 'bold' }}
                      >
                        {total.toLocaleString()}
                      </text>
                      <text
                        x={center}
                        y={center + 14}
                        textAnchor="middle"
                        className="fill-zinc-400 text-sm"
                        style={{ fontSize: '12px' }}
                      >
                        total users
                      </text>
                    </>
                  );
                })()}
              </svg>
            </div>
            
            {/* Legend & Stats */}
            <div className="w-full space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  <span className="text-sm text-zinc-300">Free Users</span>
                </div>
                <span className="text-lg font-semibold text-white">
                  {metrics.userBreakdown.free.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-sm text-zinc-300">Paid Users</span>
                </div>
                <span className="text-lg font-semibold text-white">
                  {metrics.userBreakdown.paid.toLocaleString()}
                </span>
              </div>
              <div className="pt-3 border-t border-zinc-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Conversion Rate</span>
                  <span className="text-lg font-semibold text-emerald-400">
                    {metrics.userBreakdown.paidPercentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Feature Adoption */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Feature Adoption" subtitle="Percentage of users who have used each feature">
          <BarChart
            data={featureAdoptionData}
            xKey="name"
            yKey="value"
            color="#8b5cf6"
            horizontal
          />
        </ChartCard>
      </div>

      {/* Traffic Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Traffic Sources" subtitle="Where users come from (web only)">
          {metrics.trafficSources.length > 0 ? (
            <DataTable
              data={metrics.trafficSources as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'source', header: 'Source' },
                { key: 'count', header: 'Sessions' },
              ]}
            />
          ) : (
            <div className="text-center text-zinc-500 py-8">
              No web traffic data yet
            </div>
          )}
        </ChartCard>

        <ChartCard title="UTM Campaigns" subtitle="Marketing campaign performance">
          {metrics.utmSources.length > 0 ? (
            <DataTable
              data={metrics.utmSources as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'source', header: 'Campaign' },
                { key: 'count', header: 'Sessions' },
              ]}
            />
          ) : (
            <div className="text-center text-zinc-500 py-8">
              No UTM data yet. Add ?utm_source=xxx to your URLs.
            </div>
          )}
        </ChartCard>
      </div>

      {/* Quick Stats Summary */}
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Health Check</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-zinc-400 mb-1">Engagement</div>
            <div className={`text-2xl font-bold ${metrics.dauMauRatio >= 0.2 ? 'text-emerald-400' : metrics.dauMauRatio >= 0.1 ? 'text-yellow-400' : 'text-red-400'}`}>
              {metrics.dauMauRatio >= 0.2 ? '🟢 Good' : metrics.dauMauRatio >= 0.1 ? '🟡 Fair' : '🔴 Low'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">DAU/MAU {'>'}20% is healthy</div>
          </div>
          <div>
            <div className="text-sm text-zinc-400 mb-1">Day 1 Retention</div>
            <div className={`text-2xl font-bold ${metrics.retention.day1 >= 40 ? 'text-emerald-400' : metrics.retention.day1 >= 25 ? 'text-yellow-400' : 'text-red-400'}`}>
              {metrics.retention.day1 >= 40 ? '🟢 Good' : metrics.retention.day1 >= 25 ? '🟡 Fair' : '🔴 Low'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">{'>'}40% is healthy for apps</div>
          </div>
          <div>
            <div className="text-sm text-zinc-400 mb-1">Monetization</div>
            <div className={`text-2xl font-bold ${metrics.userBreakdown.paidPercentage >= 5 ? 'text-emerald-400' : metrics.userBreakdown.paidPercentage >= 2 ? 'text-yellow-400' : 'text-red-400'}`}>
              {metrics.userBreakdown.paidPercentage >= 5 ? '🟢 Good' : metrics.userBreakdown.paidPercentage >= 2 ? '🟡 Fair' : '🔴 Low'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">{'>'}5% conversion is great</div>
          </div>
          <div>
            <div className="text-sm text-zinc-400 mb-1">Session Depth</div>
            <div className={`text-2xl font-bold ${metrics.searchesPerUser >= 3 ? 'text-emerald-400' : metrics.searchesPerUser >= 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
              {metrics.searchesPerUser >= 3 ? '🟢 Good' : metrics.searchesPerUser >= 1.5 ? '🟡 Fair' : '🔴 Low'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">{'>'}3 searches/user is engaged</div>
          </div>
        </div>
      </div>
    </div>
  );
}
