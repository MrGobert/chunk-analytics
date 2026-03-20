'use client';

import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import FunnelChart from '@/components/charts/FunnelChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { ArtifactsMetrics } from '@/types/mixpanel';

export default function ArtifactsPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();

  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<ArtifactsMetrics>(
    '/api/metrics/artifacts',
    { range: dateRange, platform, userType }
  );

  if (isLoading) {
    return <SkeletonPage statCards={4} chartCards={2} />;
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Failed to load artifacts metrics. Please try again.
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Artifacts"
        subtitle="Track artifact creation, completion, viewing, and content engagement"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Row 1 - Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Artifacts Created"
          value={metrics.totalCreated}
          trend={metrics.createdTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
        />
        <StatCard
          title="Completed"
          value={metrics.totalCompleted}
          trend={metrics.completedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Artifacts Viewed"
          value={metrics.totalViewed}
          trend={metrics.viewedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Saved to Notes"
          value={metrics.totalSavedToNotes}
          trend={metrics.savedToNotesTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          }
        />
      </div>

      {/* Row 2 - Funnel + Source Type Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Artifacts Lifecycle Funnel" subtitle="Created → Completed → Viewed → Saved to Notes">
          <FunnelChart data={metrics.artifactsFunnel} />
        </ChartCard>
        <ChartCard title="Source Type Distribution" subtitle="YouTube, Web, Podcast, Audio, Document">
          {metrics.sourceTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.sourceTypeDistribution}
              colors={['#ef4444', '#3b82f6', '#a855f7', '#22c55e', '#f97316']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No source type data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 3 - Daily Activity */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily Artifacts Activity" subtitle="Artifacts created, completed, and viewed over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'created', color: '#E84D2B', name: 'Created' },
              { key: 'completed', color: '#22c55e', name: 'Completed' },
              { key: 'viewed', color: '#3b82f6', name: 'Viewed' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Row 4 - Output Types + Tab Engagement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Output Types Requested" subtitle="Which output types users generate most">
          {metrics.outputTypeDistribution.length > 0 ? (
            <BarChart
              data={metrics.outputTypeDistribution.map((t) => ({ type: t.name, count: t.value }))}
              xKey="type"
              yKey="count"
              horizontal
              color="#E84D2B"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No output type data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Tab Engagement" subtitle="Which content tabs users view most">
          {metrics.tabSwitchDistribution.length > 0 ? (
            <BarChart
              data={metrics.tabSwitchDistribution.map((t) => ({ tab: t.name, count: t.value }))}
              xKey="tab"
              yKey="count"
              horizontal
              color="#8b5cf6"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No tab engagement data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5 - File Uploads + Saved Content Types */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="File Upload Types" subtitle="What file types users upload">
          {metrics.fileTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.fileTypeDistribution}
              colors={['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#eab308']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No file upload data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Content Saved to Notes" subtitle="Which artifact content users save">
          {metrics.savedContentTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.savedContentTypeDistribution}
              colors={['#8b5cf6', '#3b82f6', '#22c55e', '#f97316']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No saved content data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 6 - Onboarding Funnel + Summary Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Onboarding Funnel" subtitle="Viewed → Completed vs Skipped">
          <FunnelChart data={metrics.onboardingFunnel} />
        </ChartCard>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatCard
            title="Completion Rate"
            value={metrics.completionRate}
            format="percentage"
            subtitle="Created → Completed"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
          <StatCard
            title="Unique Users"
            value={metrics.uniqueArtifactUsers}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
          />
          <StatCard
            title="File Uploads"
            value={metrics.totalFileUploads}
            trend={metrics.fileUploadsTrend}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            }
          />
          <StatCard
            title="Visuals Generated"
            value={metrics.totalVisualsGenerated}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Row 7 - Additional Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Failed"
          value={metrics.totalFailed}
          subtitle="Transforms that errored"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Deleted"
          value={metrics.totalDeleted}
          subtitle="Artifacts removed by users"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          }
        />
        <StatCard
          title="Batch Runs"
          value={metrics.totalBatchStarted}
          subtitle="Multi-URL batch transforms"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
