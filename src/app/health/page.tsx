'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import gsap from 'gsap';
import { Bug, AlertTriangle, Shield, Users, Globe, Server, Smartphone, Clock, ExternalLink, Search, Sparkles, CreditCard } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { chart } from '@/lib/chartTheme';
import type { SentryStats, ReliabilityMetrics } from '@/types/mixpanel';

interface SentryIssue {
  id: string; shortId: string; title: string; culprit: string; level: string; status: string;
  isUnhandled: boolean; count: number; userCount: number; firstSeen: string; lastSeen: string;
  project: string; projectName: string; platform: string; type: string; value: string; filename: string; function: string;
}
interface SentryIssuesResponse { issues: SentryIssue[]; total: number }

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'fatal': return 'text-ember-deep bg-ember-tint border-ember/30';
    case 'error': return 'text-ember-deep bg-ember-tint border-ember/20';
    case 'warning': return 'text-[#C8922A] bg-butter-tint border-butter/40';
    case 'info': return 'text-lake bg-lake-tint border-lake/30';
    default: return 'text-ink-soft bg-paper-deep border-line';
  }
}

function getPlatformIcon(platform: string) {
  if (platform === 'web' || platform === 'javascript' || platform === 'javascript-nextjs') return <Globe className="w-3.5 h-3.5" />;
  if (platform === 'backend' || platform === 'python' || platform === 'cerebral-python-flask') return <Server className="w-3.5 h-3.5" />;
  if (platform === 'ios' || platform === 'apple-ios' || platform === 'cocoa' || platform === 'swift') return <Smartphone className="w-3.5 h-3.5" />;
  return <Bug className="w-3.5 h-3.5" />;
}

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max) + '…';
}

export default function SystemHealthPage() {
  const [dateRange, setDateRange] = useState('30d');
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  const { data: stats, isLoading: statsLoading, isRefreshing, lastUpdated } =
    useAnalytics<SentryStats>('/api/sentry/stats', { statsPeriod: dateRange, resolution: '1d' });
  const { data: issuesData, isLoading: issuesLoading } =
    useAnalytics<SentryIssuesResponse>('/api/sentry/issues', { statsPeriod: dateRange, sort: 'freq', limit: '25' });
  const { data: reliability } =
    useAnalytics<ReliabilityMetrics>('/api/metrics/reliability', { range: dateRange, platform: 'all' });

  const isLoading = statsLoading;
  const issues = issuesData?.issues || [];
  const unresolvedCount = issues.length;
  const unhandledCount = issues.filter((i) => i.isUnhandled).length;
  const affectedUsers = issues.reduce((sum, i) => sum + i.userCount, 0);

  const trendChartData = useMemo(() =>
    (stats?.errorTrend ?? []).map((point) => ({
      date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: point.errors,
    })),
  [stats?.errorTrend]);

  const issueTableData = useMemo(() =>
    issues.map((issue) => ({
      title: truncate(issue.title, 60),
      level: issue.level,
      platform: issue.platform,
      unhandled: issue.isUnhandled ? 'Yes' : 'No',
      count: issue.count,
      users: issue.userCount,
      lastSeen: timeAgo(issue.lastSeen),
      culprit: truncate(issue.culprit, 50),
    })),
  [issues]);

  useEffect(() => {
    if (hasAnimated.current || isLoading) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading]);

  if (isLoading && !stats) {
    return <SkeletonPage statCards={4} chartCards={1} chartCardLayout="grid-cols-1" />;
  }

  const periodControls = (
    <div className="flex items-center gap-1 rounded-full bg-card border border-line p-1 shadow-card">
      {['7d', '30d', '90d'].map((range) => (
        <button
          key={range}
          onClick={() => setDateRange(range)}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 ${
            dateRange === range ? 'bg-ember-deep text-[#FFF8F2]' : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={containerRef}>
      <PageHeader
        title="Health"
        subtitle="Error tracking and product reliability"
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        controls={periodControls}
      />

      {!stats ? (
        <div className="empty-state py-20">Failed to load system health data. Please try again.</div>
      ) : (
        <>
          {/* Sentry stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="card-animate"><StatCard title="Total Events" value={stats.totalErrors || 0} icon={<Bug className="w-5 h-5" />} /></div>
            <div className="card-animate"><StatCard title="Unresolved Issues" value={unresolvedCount} icon={<AlertTriangle className="w-5 h-5" />} /></div>
            <div className="card-animate"><StatCard title="Unhandled Errors" value={unhandledCount} icon={<Shield className="w-5 h-5" />} /></div>
            <div className="card-animate"><StatCard title="Affected Users" value={affectedUsers} icon={<Users className="w-5 h-5" />} /></div>
          </div>

          {/* Per-project cards */}
          {stats.projects && stats.projects.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {stats.projects.map((project) => (
                <div key={project.slug} className="card-animate card-surface card-hover p-5 sm:p-6">
                  <div className="flex items-center gap-3 mb-4 text-ink-soft">
                    {getPlatformIcon(project.platform)}
                    <span className="text-sm font-semibold tracking-tight text-ink">{project.label}</span>
                    <span className="text-xs font-mono text-ink-faint">{project.slug}</span>
                  </div>
                  <div className="flex items-baseline gap-4">
                    <div>
                      <span className="text-2xl font-medium font-mono text-ink tabular-nums">{project.totalEvents.toLocaleString()}</span>
                      <span className="text-xs font-mono text-ink-faint ml-2">events</span>
                    </div>
                    {project.totalFiltered > 0 && (
                      <div>
                        <span className="text-sm font-mono text-ink-soft">{project.totalFiltered.toLocaleString()}</span>
                        <span className="text-xs font-mono text-ink-faint ml-1">filtered</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error trend */}
          <div className="grid grid-cols-1 gap-6 mb-8">
            <div className="card-animate">
              <ChartCard title="Error Trend" subtitle={`Events over the last ${dateRange}`}>
                {trendChartData.length > 0 ? <AreaChart data={trendChartData} xKey="date" yKey="count" color={chart.emberDeep} /> : <div className="empty-state h-full">No trend data available</div>}
              </ChartCard>
            </div>
          </div>

          {/* Issues table */}
          <div className="card-animate card-surface p-6 sm:p-8 mb-12">
            <div className="flex items-center justify-between mb-6 border-b border-line pb-4">
              <div>
                <h3 className="font-display text-xl sm:text-2xl text-ink">Unresolved Issues</h3>
                <p className="text-sm font-mono text-ink-faint mt-1">Top issues by frequency</p>
              </div>
              <a href="https://sentry.io/organizations/curious-minds-software/issues/" target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-ink-soft hover:text-ember-deep border border-line hover:border-ember/30 transition-all duration-200">
                <ExternalLink className="w-4 h-4" /> Open Sentry
              </a>
            </div>
            {issuesLoading && !issuesData ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-chip" />)}</div>
            ) : issueTableData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Shield className="w-12 h-12 mb-4 text-sage" />
                <p className="text-lg font-medium text-ink">All clear</p>
                <p className="text-sm font-mono text-ink-faint mt-1">No unresolved issues</p>
              </div>
            ) : (
              <DataTable
                data={issueTableData}
                columns={[
                  { key: 'title', header: 'Title' },
                  { key: 'level', header: 'Level', render: (val) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-medium border ${getLevelColor(String(val))}`}>{String(val)}</span> },
                  { key: 'platform', header: 'Platform', render: (val) => <span className="inline-flex items-center gap-1.5 text-xs font-mono text-ink-soft">{getPlatformIcon(String(val))}{String(val)}</span> },
                  { key: 'unhandled', header: 'Unhandled', render: (val) => <span className={`text-xs font-mono ${val === 'Yes' ? 'text-ember-deep' : 'text-ink-faint'}`}>{String(val)}</span> },
                  { key: 'count', header: 'Count', numeric: true },
                  { key: 'users', header: 'Users', numeric: true },
                  { key: 'lastSeen', header: 'Last Seen', render: (val) => <span className="flex items-center gap-1 text-xs font-mono text-ink-faint"><Clock className="w-3 h-3" />{String(val)}</span> },
                  { key: 'culprit', header: 'Culprit' },
                ]}
              />
            )}
          </div>

          {/* ── Product Reliability (Mixpanel-side failures) ─────────────────── */}
          {reliability && (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-ink">Product Reliability</h2>
                <p className="text-sm text-ink-soft mt-1">User-facing failures the app reports — beyond what Sentry captures</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="card-animate"><StatCard title="Search Failure Rate" value={reliability.kpis.searchFailRate} format="percentage" invertTrend icon={<Search className="w-5 h-5" />} /></div>
                <div className="card-animate"><StatCard title="Artifact Failure Rate" value={reliability.kpis.artifactFailRate} format="percentage" invertTrend icon={<Sparkles className="w-5 h-5" />} /></div>
                <div className="card-animate"><StatCard title="Image Gen Failure Rate" value={reliability.kpis.imageFailRate} format="percentage" invertTrend icon={<Sparkles className="w-5 h-5" />} /></div>
                <div className="card-animate"><StatCard title="Automation Run Failure Rate" value={reliability.kpis.monitorRunFailRate} format="percentage" subtitle="of viewed runs" invertTrend icon={<Sparkles className="w-5 h-5" />} /></div>
                <div className="card-animate"><StatCard title="Purchase Failures" value={reliability.kpis.purchaseFailures} icon={<CreditCard className="w-5 h-5" />} /></div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card-animate">
                  <ChartCard title="Search Failure Rate Over Time" subtitle="Daily % of searches that failed">
                    <LineChart data={reliability.dailyData} xKey="date" lines={[{ key: 'searchFailRate', color: chart.emberDeep, name: 'Failure %' }]} />
                  </ChartCard>
                </div>
                <div className="card-animate">
                  <ChartCard title="Top Errors Reported" subtitle="Most common Error_Encountered messages">
                    {reliability.topErrors.length > 0 ? <BarChart data={reliability.topErrors} xKey="error" yKey="count" horizontal color={chart.emberDeep} /> : <div className="empty-state h-64">No client errors reported</div>}
                  </ChartCard>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
