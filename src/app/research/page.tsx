'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import FunnelChart from '@/components/charts/FunnelChart';
import DataTable from '@/components/charts/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ResearchMetrics } from '@/types/mixpanel';

const REPORT_TYPE_COLORS: Record<string, string> = {
  deep: '#8b5cf6',
  research_report: '#6366f1',
  detailed_report: '#3b82f6',
  outline_report: '#0ea5e9',
  resource_report: '#14b8a6',
};

export default function ResearchPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<ResearchMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/research?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch research metrics:', error);
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
        Failed to load research metrics. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Research Reports"
        subtitle="Track research report creation, completion, and engagement"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Row 1 - Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Reports Created"
          value={metrics.totalReportsInitiated}
          trend={metrics.initiatedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Completion Rate"
          value={metrics.completionRate}
          format="percentage"
          trend={metrics.completedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Reports Viewed"
          value={metrics.totalReportsViewed}
          trend={metrics.viewedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Exports & Shares"
          value={metrics.totalExports + metrics.totalShares}
          trend={metrics.exportsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
        />
      </div>

      {/* Row 2 - Funnel + Report Type Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Research Funnel" subtitle="From initiation to export/share">
          <FunnelChart data={metrics.researchFunnel} />
        </ChartCard>
        <ChartCard title="Report Type Distribution" subtitle="Which report types users create">
          {metrics.reportTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.reportTypeDistribution}
              colors={metrics.reportTypeDistribution.map((t) => REPORT_TYPE_COLORS[t.name] || '#8b5cf6')}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No report data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 3 - Daily Activity */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily Research Activity" subtitle="Reports initiated, completed, and viewed over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'initiated', color: '#8b5cf6', name: 'Initiated' },
              { key: 'completed', color: '#22c55e', name: 'Completed' },
              { key: 'viewed', color: '#3b82f6', name: 'Viewed' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Row 4 - Report Type Popularity + Tone Preferences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Report Type Popularity" subtitle="Total reports by type">
          <BarChart
            data={metrics.reportTypeDistribution.map((t) => ({ type: t.name, count: t.value }))}
            xKey="type"
            yKey="count"
            horizontal
            colors={metrics.reportTypeDistribution.map((t) => REPORT_TYPE_COLORS[t.name] || '#8b5cf6')}
          />
        </ChartCard>
        <ChartCard title="Writing Tone Preferences" subtitle="Most popular writing tones">
          {metrics.tonePreferences.length > 0 ? (
            <BarChart
              data={metrics.tonePreferences.map((t) => ({ tone: t.name, count: t.value }))}
              xKey="tone"
              yKey="count"
              horizontal
              color="#6366f1"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No tone data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5 - Export Format + Citation Format */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Export Format Distribution" subtitle="PDF vs Markdown exports">
          {metrics.exportFormatDistribution.length > 0 ? (
            <PieChart data={metrics.exportFormatDistribution} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No export data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Citation Format Usage" subtitle="Citation format preferences">
          <DataTable
            columns={[
              { key: 'format', header: 'Format' },
              { key: 'count', header: 'Count' },
              { key: 'percentage', header: '% of Total' },
            ]}
            data={metrics.citationFormatPreferences.map((c) => {
              const total = metrics.citationFormatPreferences.reduce((sum, x) => sum + x.count, 0);
              return {
                format: c.format,
                count: c.count,
                percentage: total > 0 ? `${((c.count / total) * 100).toFixed(1)}%` : '0%',
              };
            })}
          />
        </ChartCard>
      </div>

      {/* Row 6 - Average Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Avg Sources per Report"
          value={metrics.averageSourceCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          title="Avg Word Count"
          value={metrics.averageWordCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          }
        />
        <StatCard
          title="Unique Researchers"
          value={metrics.uniqueResearchUsers}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          title="Total Exports"
          value={metrics.totalExports}
          trend={metrics.exportsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
