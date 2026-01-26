'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FunnelMetrics } from '@/types/mixpanel';

export default function SubscriptionsPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [metrics, setMetrics] = useState<FunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/funnel?range=${dateRange}&platform=${platform}`);
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

  const totalRevenue = metrics.revenueByPlan.reduce((sum, p) => sum + p.revenue, 0);
  const overallConversion =
    metrics.funnel.length > 0 && metrics.funnel[0].count > 0
      ? (metrics.funnel[metrics.funnel.length - 1].count / metrics.funnel[0].count) * 100
      : 0;

  const trialConversionRate =
    metrics.trialConversion.converted + metrics.trialConversion.notConverted > 0
      ? metrics.trialConversion.converted /
        (metrics.trialConversion.converted + metrics.trialConversion.notConverted)
      : 0;

  const trialData = [
    { name: 'Converted', value: metrics.trialConversion.converted },
    { name: 'Not Converted', value: metrics.trialConversion.notConverted },
  ];

  return (
    <div>
      <PageHeader
        title="Subscription Funnel"
        subtitle="Conversion metrics and revenue analysis"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard title="Paywall Views" value={metrics.funnel[0]?.count || 0} />
        <StatCard title="Purchases" value={metrics.funnel[metrics.funnel.length - 1]?.count || 0} />
        <StatCard title="Overall Conversion" value={overallConversion / 100} format="percentage" />
        <StatCard title="Est. Revenue" value={totalRevenue} format="number" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Subscription Funnel"
          subtitle="Conversion from paywall view to purchase"
          className="h-auto"
        >
          <FunnelChart data={metrics.funnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Revenue by Plan" subtitle="Estimated revenue per plan type">
          <BarChart
            data={metrics.revenueByPlan}
            xKey="plan"
            yKey="revenue"
            horizontal
          />
        </ChartCard>
        <ChartCard title="Trial Conversion" subtitle="Users who converted after trial">
          <PieChart data={trialData} colors={['#22c55e', '#ef4444']} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Failed Purchases" subtitle="Purchase errors by type">
          {metrics.failedPurchases.length > 0 ? (
            <DataTable
              data={metrics.failedPurchases}
              columns={[
                { key: 'error', header: 'Error' },
                { key: 'count', header: 'Count' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No failed purchases in this period
            </div>
          )}
        </ChartCard>
        <ChartCard title="Paywall Sources" subtitle="Where users encountered the paywall">
          {metrics.paywallSources.length > 0 ? (
            <BarChart data={metrics.paywallSources} xKey="source" yKey="count" />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No source data available
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
