'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import FunnelChart from '@/components/charts/FunnelChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { SharingMetrics } from '@/types/mixpanel';

export default function SharingPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<SharingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/sharing?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch sharing metrics:', error);
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
        Failed to load sharing metrics. Please try again.
      </div>
    );
  }

  const totalSharesCreated = metrics.totalNotesShared + metrics.totalConversationsShared + 
                           metrics.totalResearchShared + metrics.totalCollectionsShared;
  const totalSharedViews = metrics.totalSharedNoteViews + metrics.totalSharedConversationViews + 
                          metrics.totalSharedResearchViews;

  return (
    <div>
      <PageHeader
        title="Sharing Analytics"
        subtitle="Track content sharing, shared page views, and engagement metrics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
      />

      {/* Row 1 - Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Shares Created"
          value={totalSharesCreated}
          trend={metrics.noteSharedTrend} // Using note trend as representative
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          }
        />
        <StatCard
          title="Total Shared Views"
          value={totalSharedViews}
          trend={metrics.sharedViewsTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="View-to-Share Ratio"
          value={metrics.viewToShareRatio}
          format="decimal"
          subtitle="Average views per share"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Save-to-Chunk Rate"
          value={metrics.saveToChunkClickRate}
          format="percentage"
          trend={metrics.saveClickTrend}
          subtitle="Views that click save"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
        />
      </div>

      {/* Row 2 - Shares Created Over Time + Shared Page Views Over Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Shares Created Over Time" subtitle="Share creation by content type">
          <LineChart
            data={metrics.sharesCreatedOverTime}
            xKey="date"
            lines={[
              { key: 'note', color: '#8b5cf6', name: 'Notes' },
              { key: 'conversation', color: '#3b82f6', name: 'Conversations' },
              { key: 'research', color: '#22c55e', name: 'Research' },
              { key: 'collection', color: '#f59e0b', name: 'Collections' },
            ]}
            showLegend
          />
        </ChartCard>
        <ChartCard title="Shared Page Views Over Time" subtitle="Views of shared content">
          <LineChart
            data={metrics.sharedViewsOverTime}
            xKey="date"
            lines={[
              { key: 'note', color: '#8b5cf6', name: 'Notes' },
              { key: 'conversation', color: '#3b82f6', name: 'Conversations' },
              { key: 'research', color: '#22c55e', name: 'Research' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Row 3 - Sharing Funnel */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Sharing Funnel" subtitle="Content creation to save clicks">
          <FunnelChart data={metrics.sharingFunnel} />
        </ChartCard>
      </div>

      {/* Row 4 - Content Type Breakdown + View-to-Share Ratio by Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Content Type Distribution" subtitle="Share creation by content type">
          {metrics.contentTypeDistribution.length > 0 ? (
            <PieChart
              data={metrics.contentTypeDistribution}
              colors={['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No sharing data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="View-to-Share Ratio by Type" subtitle="How often each type gets viewed after sharing">
          {metrics.viewToShareByType.some((t) => t.shares > 0) ? (
            <BarChart
              data={metrics.viewToShareByType.map((t) => ({ type: t.type, ratio: t.ratio }))}
              xKey="type"
              yKey="ratio"
              color="#6366f1"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No view ratio data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5 - Detailed Stats by Content Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Notes Shared"
          value={metrics.totalNotesShared}
          trend={metrics.noteSharedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
        <StatCard
          title="Conversations Shared"
          value={metrics.totalConversationsShared}
          trend={metrics.conversationSharedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
        />
        <StatCard
          title="Research Shared"
          value={metrics.totalResearchShared}
          trend={metrics.researchSharedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Collections Shared"
          value={metrics.totalCollectionsShared}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
      </div>

      {/* Row 6 - Shared View Stats by Content Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
        <StatCard
          title="Shared Note Views"
          value={metrics.totalSharedNoteViews}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Shared Conversation Views"
          value={metrics.totalSharedConversationViews}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Shared Research Views"
          value={metrics.totalSharedResearchViews}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Save to Chunk Clicks"
          value={metrics.totalSaveToChunkClicks}
          trend={metrics.saveClickTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
        />
      </div>
    </div>
  );
}