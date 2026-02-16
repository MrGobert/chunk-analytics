'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import FunnelChart from '@/components/charts/FunnelChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { AcquisitionFunnelMetrics } from '@/types/mixpanel';

export default function AcquisitionPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<AcquisitionFunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/acquisition?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch acquisition metrics:', error);
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
        Failed to load acquisition metrics. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Acquisition Funnel"
        subtitle="Marketing to subscriber conversion pipeline"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Conversion Rate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Marketing → Guest"
          value={metrics.conversionRates.marketingToGuest}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Guest → Signup"
          value={metrics.conversionRates.guestToSignup}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          }
        />
        <StatCard
          title="Signup → Subscriber"
          value={metrics.conversionRates.signupToSubscriber}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
        <StatCard
          title="Overall Conversion"
          value={metrics.conversionRates.overallMarketingToSubscriber}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
        />
      </div>

      {/* Funnel Visualization */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Acquisition Funnel" subtitle="User progression through funnel stages">
          <FunnelChart data={metrics.funnel} />
        </ChartCard>
      </div>

      {/* Daily Breakdown */}
      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Daily Funnel Activity" subtitle="Unique users per funnel stage per day">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'marketing', color: '#f59e0b', name: 'Marketing Visit' },
              { key: 'guest', color: '#8b5cf6', name: 'Guest Trial' },
              { key: 'signup', color: '#3b82f6', name: 'Account Created' },
              { key: 'subscriber', color: '#10b981', name: 'Subscriber' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>
    </div>
  );
}
