'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import gsap from 'gsap';
import { Bug, AlertTriangle, Shield, Users, Globe, Server, Smartphone, Clock, ExternalLink } from 'lucide-react';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectStat {
  slug: string;
  label: string;
  platform: string;
  totalEvents: number;
  totalFiltered: number;
}

interface SentryStats {
  projects: ProjectStat[];
  totalErrors: number;
  errorTrend: { date: string; errors: number }[];
  lastUpdated: string;
}

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  isUnhandled: boolean;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: string;
  projectName: string;
  platform: string;
  type: string;
  value: string;
  filename: string;
  function: string;
}

interface SentryIssuesResponse {
  issues: SentryIssue[];
  total: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
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
    case 'fatal': return 'text-red-400 bg-red-500/10 border-red-500/20';
    case 'error': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
    case 'warning': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    case 'info': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
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
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SystemHealthPage() {
  const [dateRange, setDateRange] = useState('30d');
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  const { data: stats, isLoading: statsLoading, isRefreshing, lastUpdated } =
    useAnalytics<SentryStats>('/api/sentry/stats', { statsPeriod: dateRange, resolution: '1d' });

  const { data: issuesData, isLoading: issuesLoading } =
    useAnalytics<SentryIssuesResponse>('/api/sentry/issues', { statsPeriod: dateRange, sort: 'freq', limit: '25' });

  const isLoading = statsLoading;

  // Compute derived stats from issues
  const issues = issuesData?.issues || [];
  const unresolvedCount = issues.length;
  const unhandledCount = issues.filter((i) => i.isUnhandled).length;
  const affectedUsers = issues.reduce((sum, i) => sum + i.userCount, 0);

  // Trend chart data
  const trendChartData = useMemo(() =>
    (stats?.errorTrend ?? []).map((point) => ({
      date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: point.errors,
    })),
  [stats?.errorTrend]);

  // Issues table data
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

  // GSAP animation
  useEffect(() => {
    if (hasAnimated.current || isLoading) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading]);

  if (isLoading && !stats) {
    return <SkeletonPage statCards={4} chartCards={1} chartCardLayout="grid-cols-1" />;
  }

  if (!stats) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Failed to load system health data. Please try again.
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="header-animate text-3xl md:text-4xl font-bold font-sans tracking-tight text-foreground">
            System Health
          </h1>
          <p className="header-animate text-zinc-400 mt-2 font-medium">
            Error tracking and platform stability
          </p>
          <div className="flex items-center gap-2 mt-3 header-animate">
            {lastUpdated && (
              <p className="text-xs font-mono text-zinc-500">
                Last updated: {new Date(lastUpdated).toLocaleString()}
              </p>
            )}
            {isRefreshing && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-accent/10 text-accent border border-accent/20">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Refreshing...
              </span>
            )}
          </div>
        </div>
        <div className="header-animate flex items-center bg-primary/60 backdrop-blur-xl border border-white/5 rounded-[1rem] p-1">
          {['7d', '30d', '90d'].map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                dateRange === range
                  ? 'bg-accent/10 text-accent border border-accent/30 shadow-[0_0_10px_var(--accent-glow)]'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Events"
          value={stats.totalErrors || 0}
          icon={<Bug className="w-5 h-5" />}
        />
        <StatCard
          title="Unresolved Issues"
          value={unresolvedCount}
          icon={<AlertTriangle className="w-5 h-5" />}
        />
        <StatCard
          title="Unhandled Errors"
          value={unhandledCount}
          icon={<Shield className="w-5 h-5" />}
        />
        <StatCard
          title="Affected Users"
          value={affectedUsers}
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      {/* ── Per-Project Cards ───────────────────────────────────────────── */}
      {stats.projects && stats.projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {stats.projects.map((project) => (
            <div
              key={project.slug}
              className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-5 sm:p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-white/10"
            >
              <div className="flex items-center gap-3 mb-4">
                {getPlatformIcon(project.platform)}
                <span className="text-sm font-bold tracking-tight text-zinc-300">{project.label}</span>
                <span className="text-xs font-mono text-zinc-600">{project.slug}</span>
              </div>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="text-2xl font-bold font-mono text-foreground">{project.totalEvents.toLocaleString()}</span>
                  <span className="text-xs font-mono text-zinc-500 ml-2">events</span>
                </div>
                {project.totalFiltered > 0 && (
                  <div>
                    <span className="text-sm font-mono text-zinc-500">{project.totalFiltered.toLocaleString()}</span>
                    <span className="text-xs font-mono text-zinc-600 ml-1">filtered</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Error Trend ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Error Trend" subtitle={`Events over the last ${dateRange}`}>
          {trendChartData.length > 0 ? (
            <AreaChart data={trendChartData} xKey="date" yKey="count" color="#ef4444" />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No trend data available
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── Unresolved Issues Table ─────────────────────────────────────── */}
      <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg">
        <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">
              Unresolved Issues
            </h3>
            <p className="text-sm font-mono text-zinc-400 mt-1 uppercase tracking-wide">
              Top issues by frequency
            </p>
          </div>
          <a
            href="https://sentry.io/organizations/curious-minds-software/issues/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-accent border border-white/5 hover:border-accent/30 transition-all duration-200"
          >
            <ExternalLink className="w-4 h-4" />
            Open Sentry
          </a>
        </div>

        {issuesLoading && !issuesData ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse h-16 rounded-xl bg-zinc-900/50" />
            ))}
          </div>
        ) : issueTableData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Shield className="w-12 h-12 mb-4 text-accent" />
            <p className="text-lg font-medium text-zinc-300">All clear</p>
            <p className="text-sm font-mono mt-1">No unresolved issues</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <DataTable
              data={issueTableData}
              columns={[
                { key: 'title', header: 'Title' },
                {
                  key: 'level',
                  header: 'Level',
                  render: (val) => {
                    const level = String(val);
                    return (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-medium border ${getLevelColor(level)}`}>
                        {level}
                      </span>
                    );
                  },
                },
                {
                  key: 'platform',
                  header: 'Platform',
                  render: (val) => {
                    const p = String(val);
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400">
                        {getPlatformIcon(p)}
                        {p}
                      </span>
                    );
                  },
                },
                {
                  key: 'unhandled',
                  header: 'Unhandled',
                  render: (val) => {
                    const isUnhandled = val === 'Yes';
                    return (
                      <span className={`text-xs font-mono ${isUnhandled ? 'text-red-400' : 'text-zinc-500'}`}>
                        {String(val)}
                      </span>
                    );
                  },
                },
                { key: 'count', header: 'Count' },
                { key: 'users', header: 'Users' },
                {
                  key: 'lastSeen',
                  header: 'Last Seen',
                  render: (val) => (
                    <span className="flex items-center gap-1 text-xs font-mono text-zinc-500">
                      <Clock className="w-3 h-3" />
                      {String(val)}
                    </span>
                  ),
                },
                { key: 'culprit', header: 'Culprit' },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
