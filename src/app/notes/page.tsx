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
import { NotesMetrics } from '@/types/mixpanel';

export default function NotesPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');
  const [metrics, setMetrics] = useState<NotesMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/notes?range=${dateRange}&platform=${platform}&userType=${userType}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch notes metrics:', error);
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
        Failed to load notes metrics. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notes & Writing"
        subtitle="Track note creation, editing, publishing, and AI writing tool usage"
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
          title="Notes Created"
          value={metrics.totalNotesCreated}
          trend={metrics.createdTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
        <StatCard
          title="Notes Viewed"
          value={metrics.totalNotesViewed}
          trend={metrics.viewedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Published & Shared"
          value={metrics.totalPublished + metrics.totalShared}
          trend={metrics.publishedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          }
        />
        <StatCard
          title="Writing Tools Used"
          value={metrics.totalWritingToolUses}
          trend={metrics.writingToolTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Row 2 - Funnel + Save Trigger Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Notes Lifecycle Funnel" subtitle="Created → Saved → Published → Shared">
          <FunnelChart data={metrics.notesFunnel} />
        </ChartCard>
        <ChartCard title="Save Trigger Distribution" subtitle="Auto-save vs manual save">
          {metrics.saveTriggerDistribution.length > 0 ? (
            <PieChart
              data={metrics.saveTriggerDistribution}
              colors={['#8b5cf6', '#22c55e']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No save data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 3 - Daily Activity */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Daily Notes Activity" subtitle="Notes created, viewed, and saved over time">
          <LineChart
            data={metrics.dailyData}
            xKey="date"
            lines={[
              { key: 'created', color: '#8b5cf6', name: 'Created' },
              { key: 'viewed', color: '#3b82f6', name: 'Viewed' },
              { key: 'saved', color: '#22c55e', name: 'Saved' },
            ]}
            showLegend
          />
        </ChartCard>
      </div>

      {/* Row 4 - Writing Tool Usage + Feature Adoption */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Writing Tool Usage by Type" subtitle="Which AI writing tools are most used">
          {metrics.writingToolDistribution.length > 0 ? (
            <BarChart
              data={metrics.writingToolDistribution.map((t) => ({ tool: t.name, count: t.value }))}
              xKey="tool"
              yKey="count"
              horizontal
              color="#8b5cf6"
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No writing tool data yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Feature Adoption" subtitle="Publishing, sharing, and document uploads">
          {metrics.featureAdoption.some((f) => f.value > 0) ? (
            <PieChart
              data={metrics.featureAdoption}
              colors={['#8b5cf6', '#6366f1', '#3b82f6']}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500">
              No feature adoption data yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5 - Retention + Upload Rate Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Notes Retention"
          value={metrics.retentionRate}
          format="percentage"
          subtitle="Created vs deleted ratio"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Document Upload Rate"
          value={metrics.documentUploadRate}
          format="percentage"
          subtitle="Notes uploaded to documents"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
        />
        <StatCard
          title="Unique Note Users"
          value={metrics.uniqueNoteUsers}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          title="Notes Deleted"
          value={metrics.totalNotesDeleted}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
