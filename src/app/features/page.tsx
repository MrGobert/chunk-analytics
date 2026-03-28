'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import LineChart from '@/components/charts/LineChart';
import FunnelChart from '@/components/charts/FunnelChart';
import FeatureTabBar, { FEATURE_TABS } from '@/components/features/FeatureTabBar';
import { SkeletonPage, SkeletonStatCard, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type {
  FeatureOverviewMetrics,
  SearchMetrics,
  ResearchMetrics,
  NotesMetrics,
  CollectionsMetrics,
  ArtifactsMetrics,
  SharingMetrics,
} from '@/types/mixpanel';

// ─── Color palette ──────────────────────────────────────────────────────────

const FEATURE_COLORS = [
  '#E63B2E', // Signal Red
  '#8b5cf6', // Violet
  '#0ea5e9', // Sky Blue
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#ec4899', // Pink
  '#6366f1', // Indigo
  '#3b82f6', // Blue
];

// ─── Shared filter props ────────────────────────────────────────────────────

interface FilterProps {
  dateRange: string;
  platform: string;
  userType: string;
}

// ─── Tab Section Skeleton ───────────────────────────────────────────────────

function TabSkeleton() {
  return (
    <div className="animate-in fade-in duration-200 mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <SkeletonChartCard />
        <SkeletonChartCard />
      </div>
    </div>
  );
}

// ─── Search Tab ─────────────────────────────────────────────────────────────

function SearchSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<
    SearchMetrics & { totalSearches: number; searchTrend: number | null }
  >('/api/metrics/searches', { range: dateRange, platform, userType });

  if (isLoading || !metrics) return <TabSkeleton />;

  const avgDaily = metrics.searchesOverTime.length > 0
    ? Math.round(metrics.totalSearches / metrics.searchesOverTime.length)
    : 0;

  const peakHour = metrics.hourlyDistribution.length > 0
    ? metrics.hourlyDistribution.reduce((max, curr) => (curr.count > max.count ? curr : max)).hour
    : 0;

  const searchModeData = metrics.searchModes.map((m) => ({ name: m.mode, value: m.count }));

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="Total Searches" value={metrics.totalSearches} trend={metrics.searchTrend} />
        <StatCard title="Avg Daily Searches" value={avgDaily} />
        <StatCard title="Peak Hour" value={`${peakHour}:00`} format="text" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Searches Over Time" subtitle="Daily search volume">
          <AreaChart data={metrics.searchesOverTime} xKey="date" yKey="searches" color="#8b5cf6" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Search Modes" subtitle="Distribution of search modes">
          <PieChart data={searchModeData} />
        </ChartCard>
        <ChartCard title="Models Used" subtitle="AI models selected for searches">
          <BarChart data={metrics.modelsUsed} xKey="model" yKey="count" horizontal />
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Research Tab ───────────────────────────────────────────────────────────

function ResearchSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<ResearchMetrics>(
    '/api/metrics/research',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Reports Created" value={metrics.totalReportsInitiated} trend={metrics.initiatedTrend} />
        <StatCard title="Completion Rate" value={metrics.completionRate} format="percentage" />
        <StatCard title="Reports Viewed" value={metrics.totalReportsViewed} trend={metrics.viewedTrend} />
        <StatCard title="Exports" value={metrics.totalExports} trend={metrics.exportsTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Research Funnel" subtitle="From initiation to export/share">
          <FunnelChart data={metrics.researchFunnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Report Type Distribution" subtitle="Which report types users create">
          {metrics.reportTypeDistribution.length > 0 ? (
            <PieChart data={metrics.reportTypeDistribution} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No report data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Daily Activity" subtitle="Reports initiated, completed, and viewed over time">
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
    </div>
  );
}

// ─── Notes Tab ──────────────────────────────────────────────────────────────

function NotesSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<NotesMetrics>(
    '/api/metrics/notes',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Notes Created" value={metrics.totalNotesCreated} trend={metrics.createdTrend} />
        <StatCard title="Notes Viewed" value={metrics.totalNotesViewed} trend={metrics.viewedTrend} />
        <StatCard title="Published" value={metrics.totalPublished} trend={metrics.publishedTrend} />
        <StatCard title="Writing Tools Used" value={metrics.totalWritingToolUses} trend={metrics.writingToolTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Notes Lifecycle Funnel" subtitle="Created → Saved → Published → Shared">
          <FunnelChart data={metrics.notesFunnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Writing Tool Distribution" subtitle="Which AI writing tools are most used">
          {metrics.writingToolDistribution.length > 0 ? (
            <BarChart
              data={metrics.writingToolDistribution.map((t) => ({ tool: t.name, count: t.value }))}
              xKey="tool"
              yKey="count"
              horizontal
              color="#8b5cf6"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No writing tool data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Save Trigger Distribution" subtitle="Auto-save vs manual save">
          {metrics.saveTriggerDistribution.length > 0 ? (
            <PieChart data={metrics.saveTriggerDistribution} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No save data yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Collections Tab ────────────────────────────────────────────────────────

function CollectionsSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<CollectionsMetrics>(
    '/api/metrics/collections',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Created" value={metrics.totalCreated} trend={metrics.createdTrend} />
        <StatCard title="Viewed" value={metrics.totalViewed} trend={metrics.viewedTrend} />
        <StatCard title="Chat Sessions" value={metrics.totalChatStarted} trend={metrics.chatStartedTrend} />
        <StatCard title="Exports" value={metrics.totalExported} trend={metrics.exportedTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Collections Funnel" subtitle="Created → Viewed → Chat Started → Exported/Shared">
          <FunnelChart data={metrics.collectionsFunnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="URL Management" subtitle="URLs added vs removed over time">
          {metrics.urlManagement.some((d) => d.added > 0 || d.removed > 0) ? (
            <LineChart
              data={metrics.urlManagement}
              xKey="date"
              lines={[
                { key: 'added', color: '#22c55e', name: 'URLs Added' },
                { key: 'removed', color: '#ef4444', name: 'URLs Removed' },
              ]}
              showLegend
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No URL management data yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Artifacts Tab ──────────────────────────────────────────────────────────

function ArtifactsSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<ArtifactsMetrics>(
    '/api/metrics/artifacts',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Created" value={metrics.totalCreated} trend={metrics.createdTrend} />
        <StatCard title="Completed" value={metrics.totalCompleted} trend={metrics.completedTrend} />
        <StatCard title="Viewed" value={metrics.totalViewed} trend={metrics.viewedTrend} />
        <StatCard title="Saved to Notes" value={metrics.totalSavedToNotes} trend={metrics.savedToNotesTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Artifacts Lifecycle Funnel" subtitle="Created → Completed → Viewed → Saved to Notes">
          <FunnelChart data={metrics.artifactsFunnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Source Type Distribution" subtitle="YouTube, Web, Podcast, Audio, Document">
          {metrics.sourceTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.sourceTypeDistribution}
              colors={['#ef4444', '#3b82f6', '#a855f7', '#22c55e', '#f97316']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No source type data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Output Types" subtitle="Which output types users generate most">
          {metrics.outputTypeDistribution.length > 0 ? (
            <BarChart
              data={metrics.outputTypeDistribution.map((t) => ({ type: t.name, count: t.value }))}
              xKey="type"
              yKey="count"
              horizontal
              color="#E84D2B"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No output type data yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Sharing Tab ────────────────────────────────────────────────────────────

function SharingSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<SharingMetrics>(
    '/api/metrics/sharing',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  const totalSharesCreated =
    metrics.totalNotesShared + metrics.totalConversationsShared +
    metrics.totalResearchShared + metrics.totalCollectionsShared;
  const totalSharedViews =
    metrics.totalSharedNoteViews + metrics.totalSharedConversationViews +
    metrics.totalSharedResearchViews + metrics.totalSharedCollectionViews;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total Shares" value={totalSharesCreated} trend={metrics.noteSharedTrend} />
        <StatCard title="Total Views" value={totalSharedViews} trend={metrics.sharedViewsTrend} />
        <StatCard title="View-to-Share Ratio" value={metrics.viewToShareRatio} format="decimal" />
        <StatCard title="Save-to-Chunk Rate" value={metrics.saveToChunkClickRate} format="percentage" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Sharing Funnel" subtitle="Content creation to save clicks">
          <FunnelChart data={metrics.sharingFunnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Content Type Distribution" subtitle="Share creation by content type">
          {metrics.contentTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.contentTypeDistribution}
              colors={['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">No sharing data yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Active Tab Content ─────────────────────────────────────────────────────

function TabContent({ activeTab, dateRange, platform, userType }: FilterProps & { activeTab: string }) {
  switch (activeTab) {
    case 'search':
      return <SearchSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'research':
      return <ResearchSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'notes':
      return <NotesSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'collections':
      return <CollectionsSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'artifacts':
      return <ArtifactsSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'sharing':
      return <SharingSection dateRange={dateRange} platform={platform} userType={userType} />;
    default:
      return null;
  }
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function FeaturesPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();
  const [activeTab, setActiveTab] = useState('search');
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  const { data: overview, isLoading: isOverviewLoading, isRefreshing, lastUpdated } =
    useAnalytics<FeatureOverviewMetrics>('/api/metrics/feature-overview', { range: dateRange, platform, userType });

  // GSAP animation on mount / when overview loads
  useEffect(() => {
    if (!isOverviewLoading && overview && !hasAnimated.current) {
      hasAnimated.current = true;
      const ctx = gsap.context(() => {
        gsap.fromTo(
          '.card-animate',
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: 'power3.out' },
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, [isOverviewLoading, overview]);

  if (isOverviewLoading) {
    return <SkeletonPage statCards={0} chartCards={2} chartCardLayout="grid-cols-1 lg:grid-cols-2" />;
  }

  // Prepare bar chart data from overview
  const eventsData = useMemo(() =>
    (overview?.features ?? []).map((f) => ({
      feature: f.name,
      count: f.totalEvents,
    })),
    [overview?.features]
  );

  const usersData = useMemo(() =>
    (overview?.features ?? []).map((f) => ({
      feature: f.name,
      count: f.uniqueUsers,
    })),
    [overview?.features]
  );

  return (
    <div ref={containerRef}>
      <PageHeader
        title="Features"
        subtitle="Cross-feature overview and deep dives"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* ── Feature Overview Charts ────────────────────────────────────────── */}
      {overview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <ChartCard title="Events by Feature" subtitle="Total events per feature">
            <BarChart
              data={eventsData}
              xKey="feature"
              yKey="count"
              horizontal
              colors={eventsData.map((_, i) => FEATURE_COLORS[i % FEATURE_COLORS.length])}
            />
          </ChartCard>
          <ChartCard title="Users by Feature" subtitle="Unique users per feature">
            <BarChart
              data={usersData}
              xKey="feature"
              yKey="count"
              horizontal
              colors={usersData.map((_, i) => FEATURE_COLORS[i % FEATURE_COLORS.length])}
            />
          </ChartCard>
        </div>
      )}

      {/* ── Tab Bar ────────────────────────────────────────────────────────── */}
      <FeatureTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* ── Tab Content (lazy-loaded per tab) ──────────────────────────────── */}
      <TabContent
        activeTab={activeTab}
        dateRange={dateRange}
        platform={platform}
        userType={userType}
      />
    </div>
  );
}
