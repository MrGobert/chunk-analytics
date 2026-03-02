'use client';

import { useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import HeatmapChart from '@/components/charts/HeatmapChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { SearchMetrics } from '@/types/mixpanel';

export default function SearchesPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');

  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<SearchMetrics & { totalSearches: number }>(
    '/api/metrics/searches',
    { range: dateRange, platform, userType }
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

  const searchModeData = metrics.searchModes.map((m) => ({
    name: m.mode,
    value: m.count,
  }));

  const contextData = metrics.contextUsage.map((c) => ({
    name: c.hasContext ? 'With Context' : 'Without Context',
    value: c.count,
  }));

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Search Analytics"
        subtitle="Search patterns and usage insights"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="Total Searches" value={metrics.totalSearches} />
        <StatCard
          title="Avg Daily Searches"
          value={Math.round(metrics.totalSearches / metrics.searchesOverTime.length) || 0}
        />
        <StatCard
          title="Peak Hour"
          value={metrics.hourlyDistribution.reduce((max, curr) =>
            curr.count > max.count ? curr : max
          ).hour}
          format="number"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Searches Over Time" subtitle="Daily search volume">
          <AreaChart data={metrics.searchesOverTime} xKey="date" yKey="searches" color="#8b5cf6" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Search Modes" subtitle="Auto vs manual search modes">
          <PieChart data={searchModeData} />
        </ChartCard>
        <ChartCard title="Context Usage" subtitle="Searches with vs without context">
          <PieChart data={contextData} colors={['#22c55e', '#ef4444']} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Models Used" subtitle="AI models selected for searches">
          <BarChart data={metrics.modelsUsed} xKey="model" yKey="count" horizontal />
        </ChartCard>
        <ChartCard title="Search Times (Hour of Day)" subtitle="When users search most">
          <HeatmapChart data={metrics.hourlyDistribution} />
        </ChartCard>
      </div>
    </div>
  );
}
