'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Brain } from 'lucide-react';
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
import { chart } from '@/lib/chartTheme';
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
  ConnectorsMetrics,
  ConnectionsMetrics,
} from '@/types/mixpanel';

// ─── Color palette ──────────────────────────────────────────────────────────

const FEATURE_COLORS = chart.series;

// ─── Shared filter props ────────────────────────────────────────────────────

interface FilterProps {
  dateRange: string;
  platform: string;
  userType: string;
}

// ─── Data Unavailable Banner ────────────────────────────────────────────────

function DataUnavailableBanner() {
  return (
    <div className="mb-8 rounded-card border border-butter bg-butter-tint px-4 py-3 text-sm text-ink">
      Live analytics data is temporarily unavailable — the Mixpanel export
      couldn’t be reached and no cached data was available. Figures below may
      read as zero; retry shortly.
    </div>
  );
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
  // 12-hour label (0 → "12am", 13 → "1pm") so the card reads naturally.
  const peakHourLabel = `${((peakHour + 11) % 12) + 1}${peakHour < 12 ? 'am' : 'pm'}`;

  const searchModeData = metrics.searchModes.map((m) => ({ name: m.mode, value: m.count }));
  const modelLines = (metrics.topModels || []).map((m, i) => ({
    key: m,
    color: i === 0 ? chart.primary : chart.series[i % chart.series.length],
    name: m.length > 18 ? `${m.slice(0, 18)}…` : m,
  }));
  const responseTimeData = (metrics.responseTimes || []).map((r) => ({
    model: r.model.length > 16 ? `${r.model.slice(0, 16)}…` : r.model,
    p50: r.p50,
    p90: r.p90,
  }));

  return (
    <div className="mt-8">
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total Searches" value={metrics.totalSearches} trend={metrics.searchTrend} />
        <StatCard title="Avg Daily Searches" value={avgDaily} />
        <StatCard title="Peak Hour" value={peakHourLabel} format="text" />
        <StatCard title="Search Failure Rate" value={metrics.searchFailRate ?? 0} format="percentage" invertTrend />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Searches Over Time" subtitle="Daily search volume">
          {metrics.searchesOverTime.length > 0 ? (
            <AreaChart data={metrics.searchesOverTime} xKey="date" yKey="searches" color={chart.series[0]} />
          ) : (
            <div className="empty-state h-64">No search data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Search Modes" subtitle="Distribution of search modes">
          <PieChart data={searchModeData} />
        </ChartCard>
        <ChartCard title="Models Used" subtitle="AI models selected for searches">
          <BarChart data={metrics.modelsUsed} xKey="model" yKey="count" horizontal />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Model Mix Over Time" subtitle="Daily search volume by top model">
          {modelLines.length > 0 ? (
            <LineChart data={metrics.modelsOverTime || []} xKey="date" lines={modelLines} showLegend />
          ) : (
            <div className="empty-state h-64">No model data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Response Time by Model" subtitle="p50 / p90 latency in ms">
          {responseTimeData.length > 0 ? (
            <BarChart data={responseTimeData} xKey="model" yKey="p90" horizontal color={chart.series[3]} />
          ) : (
            <div className="empty-state h-64">No response-time data captured</div>
          )}
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
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Reports Created" value={metrics.totalReportsInitiated} trend={metrics.initiatedTrend} />
        <StatCard title="Completion Rate" value={metrics.completionRate} format="percentage" />
        <StatCard title="Reports Viewed" value={metrics.totalReportsViewed} trend={metrics.viewedTrend} />
        <StatCard title="Exports" value={metrics.totalExports} trend={metrics.exportsTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Research Funnel" subtitle="From initiation to export/share">
          {metrics.researchFunnel.length > 0 ? (
            <FunnelChart data={metrics.researchFunnel} />
          ) : (
            <div className="empty-state h-64">No funnel data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Report Type Distribution" subtitle="Which report types users create">
          {metrics.reportTypeDistribution.length > 0 ? (
            <PieChart data={metrics.reportTypeDistribution} />
          ) : (
            <div className="empty-state h-64">No report data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Daily Activity" subtitle="Reports initiated, completed, and viewed over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'initiated', color: chart.series[0], name: 'Initiated' },
              { key: 'completed', color: chart.sage, name: 'Completed' },
              { key: 'viewed', color: chart.series[1], name: 'Viewed' },
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
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Notes Created"
          value={metrics.totalNotesCreated}
          trend={metrics.createdTrend}
          subtitle={`by ${(metrics.uniqueNoteCreators ?? 0).toLocaleString()} unique user${metrics.uniqueNoteCreators === 1 ? '' : 's'}`}
        />
        <StatCard title="Notes Viewed" value={metrics.totalNotesViewed} trend={metrics.viewedTrend} />
        <StatCard title="Published" value={metrics.totalPublished} trend={metrics.publishedTrend} />
        <StatCard title="Writing Tools Used" value={metrics.totalWritingToolUses} trend={metrics.writingToolTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Notes Lifecycle Funnel"
          subtitle="Unique users per stage (each must reach all prior stages) — Created → Saved → Published → Shared"
        >
          {metrics.notesFunnel.length > 0 ? (
            <FunnelChart data={metrics.notesFunnel} unitLabel="users" />
          ) : (
            <div className="empty-state h-64">No funnel data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Writing Tool Distribution" subtitle="Which AI writing tools are most used">
          {metrics.writingToolDistribution.length > 0 ? (
            <BarChart
              data={metrics.writingToolDistribution.map((t) => ({ tool: t.name, count: t.value }))}
              xKey="tool"
              yKey="count"
              horizontal
              color={chart.series[0]}
            />
          ) : (
            <div className="empty-state h-64">No writing tool data yet</div>
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
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Created" value={metrics.totalCreated} trend={metrics.createdTrend} />
        <StatCard title="Viewed" value={metrics.totalViewed} trend={metrics.viewedTrend} />
        <StatCard title="Chat Sessions" value={metrics.totalChatStarted} trend={metrics.chatStartedTrend} />
        <StatCard title="Exports" value={metrics.totalExported} trend={metrics.exportedTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Collections Funnel" subtitle="Created → Viewed → Chat Started → Exported/Shared">
          {metrics.collectionsFunnel.length > 0 ? (
            <FunnelChart data={metrics.collectionsFunnel} />
          ) : (
            <div className="empty-state h-64">No funnel data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="URL Management" subtitle="URLs added vs removed over time">
          {metrics.urlManagement.some((d) => d.added > 0 || d.removed > 0) ? (
            <LineChart
              data={metrics.urlManagement}
              xKey="date"
              lines={[
                { key: 'added', color: chart.sage, name: 'URLs Added' },
                { key: 'removed', color: chart.emberDeep, name: 'URLs Removed' },
              ]}
              showLegend
            />
          ) : (
            <div className="empty-state h-64">No URL management data yet</div>
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
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Created" value={metrics.totalCreated} trend={metrics.createdTrend} />
        <StatCard title="Completed" value={metrics.totalCompleted} trend={metrics.completedTrend} />
        <StatCard title="Viewed" value={metrics.totalViewed} trend={metrics.viewedTrend} />
        <StatCard title="Saved to Notes" value={metrics.totalSavedToNotes} trend={metrics.savedToNotesTrend} />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Artifacts Lifecycle Funnel" subtitle="Created → Completed → Viewed → Saved to Notes">
          {metrics.artifactsFunnel.length > 0 ? (
            <FunnelChart data={metrics.artifactsFunnel} />
          ) : (
            <div className="empty-state h-64">No funnel data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Source Type Distribution" subtitle="YouTube, Web, Podcast, Audio, Document">
          {metrics.sourceTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.sourceTypeDistribution}
              colors={[...chart.series]}
            />
          ) : (
            <div className="empty-state h-64">No source type data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Output Types" subtitle="Which output types users generate most">
          {metrics.outputTypeDistribution.length > 0 ? (
            <BarChart
              data={metrics.outputTypeDistribution.map((t) => ({ type: t.name, count: t.value }))}
              xKey="type"
              yKey="count"
              horizontal
              color={chart.primary}
            />
          ) : (
            <div className="empty-state h-64">No output type data yet</div>
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
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total Shares" value={totalSharesCreated} trend={metrics.totalSharesTrend} />
        <StatCard title="Total Views" value={totalSharedViews} trend={metrics.sharedViewsTrend} />
        <StatCard title="View-to-Share Ratio" value={metrics.viewToShareRatio} format="decimal" />
        <StatCard title="Save-to-Chunk Rate" value={metrics.saveToChunkClickRate} format="percentage" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Sharing Funnel" subtitle="Content creation to save clicks">
          {metrics.sharingFunnel.length > 0 ? (
            <FunnelChart data={metrics.sharingFunnel} />
          ) : (
            <div className="empty-state h-64">No funnel data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Content Type Distribution" subtitle="Share creation by content type">
          {metrics.contentTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.contentTypeDistribution}
              colors={[...chart.series]}
            />
          ) : (
            <div className="empty-state h-64">No sharing data yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Connectors Tab ─────────────────────────────────────────────────────────

function ConnectionsSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<ConnectionsMetrics>(
    '/api/metrics/connections',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  return (
    <div className="mt-8">
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Items Previewed"
          value={metrics.itemsPreviewed}
          subtitle="Connection cards opened for preview"
        />
        <StatCard
          title="Pins Added"
          value={metrics.pinsAdded}
          subtitle={`${metrics.pinsToggled} pin toggles total`}
        />
        <StatCard
          title="References Sent"
          value={metrics.referencesSentItems}
          subtitle={`${metrics.referencesSentEvents} sends carried pinned context`}
        />
        <StatCard
          title="Active Users"
          value={metrics.uniqueUsers}
          subtitle="Unique users engaging Connections"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard title="Mentions Used" value={metrics.mentionsUsed} subtitle="@-mention pinned an object" />
        <StatCard title="Card Actions" value={metrics.actionsUsed} subtitle="Open / collection / note / inbox" />
        <StatCard
          title="Collections Created"
          value={metrics.collectionsCreated}
          subtitle={`${metrics.collectionsWithConversation} included the conversation`}
        />
        <StatCard
          title="Recall Accept Rate"
          value={metrics.recallAcceptRate}
          format="percentage"
          subtitle={`${metrics.recallShown} shown · ${metrics.recallAccepted} accepted`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Ambient Recall Funnel"
          subtitle="Suggestions shown → accepted (pinned)"
        >
          {metrics.recallShown > 0 ? (
            <FunnelChart data={metrics.recallFunnel} />
          ) : (
            <div className="empty-state h-64">No recall data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="What Users Connect" subtitle="Engagements by object type">
          {metrics.objectTypeMix.length > 0 ? (
            <PieChart data={metrics.objectTypeMix} colors={[...chart.series]} />
          ) : (
            <div className="empty-state h-64">No object-type data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Card Actions" subtitle="Which actions run from a connection card">
          {metrics.actionMix.length > 0 ? (
            <BarChart
              data={metrics.actionMix}
              xKey="name"
              yKey="value"
              horizontal
              color={chart.series[4]}
            />
          ) : (
            <div className="empty-state h-64">No action data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Pin Outcomes" subtitle="Pinned vs unpinned">
          {metrics.pinOutcomes.length > 0 ? (
            <PieChart data={metrics.pinOutcomes} colors={[chart.sage, chart.emberDeep]} />
          ) : (
            <div className="empty-state h-64">No pin data yet</div>
          )}
        </ChartCard>
        <ChartCard title="Web vs Apple" subtitle="Connections engagements by platform">
          {metrics.connectionsByPlatform.length > 0 ? (
            <PieChart data={metrics.connectionsByPlatform} colors={[...chart.series]} />
          ) : (
            <div className="empty-state h-64">No platform data yet</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Daily Activity" subtitle="Engagements and previews per day">
          {metrics.dailyTrend.some((d) => d.engagements > 0 || d.previews > 0) ? (
            <LineChart
              data={metrics.dailyTrend}
              xKey="date"
              lines={[
                { key: 'engagements', color: chart.sage, name: 'Engagements' },
                { key: 'previews', color: chart.series[0], name: 'Previews' },
              ]}
              showLegend
            />
          ) : (
            <div className="empty-state h-64">No activity yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function ConnectorsSection({ dateRange, platform, userType }: FilterProps) {
  const { data: metrics, isLoading } = useAnalytics<ConnectorsMetrics>(
    '/api/metrics/connectors',
    { range: dateRange, platform, userType },
  );

  if (isLoading || !metrics) return <TabSkeleton />;

  const operationsByConnector = metrics.operationBreakdown.map((row) => ({
    label: `${row.connector} · ${row.operation}`,
    count: row.count,
  }));

  return (
    <div className="mt-8">
      {metrics.dataUnavailable && <DataUnavailableBanner />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Connections Started"
          value={metrics.totalConnectStarted}
          trend={metrics.connectStartedTrend}
        />
        <StatCard
          title="Connect Success Rate"
          value={metrics.connectSuccessRate}
          format="percentage"
        />
        <StatCard
          title="Operations Used"
          value={metrics.totalOperations}
          trend={metrics.operationsTrend}
        />
        <StatCard
          title="Active Users"
          value={metrics.uniqueConnectedUsers}
          subtitle="Unique users with connector activity"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Failed Connects"
          value={metrics.totalConnectFailed}
        />
        <StatCard
          title="OAuth Callback Success"
          value={metrics.oauthCallbackSuccessRate}
          format="percentage"
        />
        <StatCard
          title="Disconnected"
          value={metrics.totalDisconnected}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Disconnect Failures"
          value={metrics.totalDisconnectFailed}
          subtitle="Disconnect attempts that errored"
        />
        <StatCard
          title="Status Degraded"
          value={metrics.totalStatusDegraded}
          subtitle="Connected → error/expired (e.g. token expiry)"
        />
        <StatCard
          title="Settings Viewed"
          value={metrics.totalSettingsViewed}
          subtitle={`${metrics.uniqueSettingsViewers} unique viewers`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Connection Funnel"
          subtitle="Viewed → Start → Succeed → First Operation"
        >
          {metrics.connectorsFunnel.length > 0 ? (
            <FunnelChart data={metrics.connectorsFunnel} />
          ) : (
            <div className="empty-state h-64">
              No funnel data yet
            </div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Which App Is Used" subtitle="Operations by connector">
          {metrics.connectorBreakdown.length > 0 ? (
            <PieChart
              data={metrics.connectorBreakdown}
              colors={[...chart.series]}
            />
          ) : (
            <div className="empty-state h-64">
              No operation data yet
            </div>
          )}
        </ChartCard>
        <ChartCard
          title="Operations Breakdown"
          subtitle="By connector and operation"
        >
          {operationsByConnector.length > 0 ? (
            <BarChart
              data={operationsByConnector}
              xKey="label"
              yKey="count"
              horizontal
              color={chart.series[4]}
            />
          ) : (
            <div className="empty-state h-64">
              No operation data yet
            </div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Daily Activity"
          subtitle="Connects, operations, and disconnects per day"
        >
          {metrics.dailyActivity.some(
            (d) => d.connects > 0 || d.operations > 0 || d.disconnects > 0
          ) ? (
            <LineChart
              data={metrics.dailyActivity}
              xKey="date"
              lines={[
                { key: 'connects', color: chart.sage, name: 'Connects' },
                { key: 'operations', color: chart.series[0], name: 'Operations' },
                { key: 'disconnects', color: chart.emberDeep, name: 'Disconnects' },
              ]}
              showLegend
            />
          ) : (
            <div className="empty-state h-64">
              No activity yet
            </div>
          )}
        </ChartCard>
      </div>

      {metrics.topErrors.length > 0 && (
        <div className="grid grid-cols-1 gap-6">
          <ChartCard
            title="Top Errors"
            subtitle="Most common failures across connect and operation events"
          >
            <BarChart
              data={metrics.topErrors}
              xKey="error"
              yKey="count"
              horizontal
              color={chart.emberDeep}
            />
          </ChartCard>
        </div>
      )}
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
    case 'connections':
      return <ConnectionsSection dateRange={dateRange} platform={platform} userType={userType} />;
    case 'connectors':
      return <ConnectorsSection dateRange={dateRange} platform={platform} userType={userType} />;
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

  // Prepare bar chart data from overview (must be before conditional return to keep hook order stable)
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

  const stickinessData = useMemo(() =>
    (overview?.features ?? [])
      .filter((f) => typeof f.stickiness === 'number' && f.uniqueUsers > 0)
      .map((f) => ({ feature: f.name, stickiness: Math.round((f.stickiness as number) * 1000) / 10 }))
      .sort((a, b) => b.stickiness - a.stickiness),
    [overview?.features]
  );

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

      {overview?.dataUnavailable && <DataUnavailableBanner />}

      {/* ── Memory Enabled Stat Card ─────────────────────────────────────── */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Memory Enabled"
            value={overview.memoryEnabled.uniqueUsers}
            trend={overview.memoryEnabled.trend}
            icon={<Brain className="w-4 h-4" />}
            subtitle="Users who turned on Memory"
          />
        </div>
      )}

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

      {/* ── Feature Stickiness ─────────────────────────────────────────────── */}
      {overview && stickinessData.length > 0 && (
        <div className="grid grid-cols-1 gap-6 mb-8">
          <ChartCard title="Feature Stickiness" subtitle="DAU/MAU per feature — which features become daily habits (%)">
            <BarChart data={stickinessData} xKey="feature" yKey="stickiness" horizontal color={chart.lake} />
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
