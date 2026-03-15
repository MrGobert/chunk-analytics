'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Bug, AlertTriangle, Shield, Globe, Server, Clock, ExternalLink } from 'lucide-react';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PERIOD_MAP: Record<string, string> = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
};

const RESOLUTION_MAP: Record<string, string> = {
  '7d': '1d',
  '30d': '1d',
  '90d': '1d',
};

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
  if (platform === 'web' || platform === 'javascript') return <Globe className="w-3.5 h-3.5" />;
  if (platform === 'backend' || platform === 'python') return <Server className="w-3.5 h-3.5" />;
  return <Bug className="w-3.5 h-3.5" />;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SentryPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [projectFilter, setProjectFilter] = useState('all');
  const containerRef = useRef<HTMLDivElement>(null);

  const statsPeriod = PERIOD_MAP[dateRange] || '30d';
  const resolution = RESOLUTION_MAP[dateRange] || '1d';

  const { data: stats, isLoading: statsLoading, isRefreshing, lastUpdated } = useAnalytics<SentryStats>(
    '/api/sentry/stats',
    { statsPeriod, resolution }
  );

  const { data: issuesData, isLoading: issuesLoading } = useAnalytics<SentryIssuesResponse>(
    '/api/sentry/issues',
    {
      statsPeriod,
      sort: 'freq',
      limit: '25',
      ...(projectFilter !== 'all' && { project: projectFilter }),
    }
  );

  // Animate on mount
  useEffect(() => {
    if (statsLoading || !containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [statsLoading, dateRange]);

  if (statsLoading && !stats) {
    return <SkeletonPage statCards={4} chartCards={1} chartCardLayout="grid-cols-1" />;
  }

  const issues = issuesData?.issues || [];
  const unresolvedCount = issues.length;
  const unhandledCount = issues.filter((i) => i.isUnhandled).length;
  const affectedUsers = issues.reduce((sum, i) => sum + i.userCount, 0);

  return (
    <div ref={containerRef}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="header-animate text-3xl md:text-4xl font-bold font-sans tracking-tight text-foreground">
            Error Tracking
          </h1>
          <p className="header-animate text-zinc-400 mt-2 font-medium">
            Sentry issues across Chunk platforms
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
        <div className="header-animate flex flex-wrap items-center gap-3">
          {/* Project Filter */}
          <div className="flex items-center bg-primary/60 backdrop-blur-xl border border-white/5 rounded-[1rem] p-1">
            {['all', 'javascript-nextjs', 'cerebral-python-flask'].map((key) => {
              const labels: Record<string, string> = {
                all: 'All',
                'javascript-nextjs': 'Web',
                'cerebral-python-flask': 'API',
              };
              return (
                <button
                  key={key}
                  onClick={() => setProjectFilter(key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    projectFilter === key
                      ? 'bg-accent/10 text-accent border border-accent/30 shadow-[0_0_10px_var(--accent-glow)]'
                      : 'text-zinc-500 hover:text-white border border-transparent'
                  }`}
                >
                  {labels[key]}
                </button>
              );
            })}
          </div>
          {/* Date Range */}
          <div className="flex items-center bg-primary/60 backdrop-blur-xl border border-white/5 rounded-[1rem] p-1">
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
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Events"
          value={stats?.totalErrors || 0}
          format="number"
          icon={<Bug className="w-5 h-5" />}
        />
        <StatCard
          title="Unresolved Issues"
          value={unresolvedCount}
          format="number"
          icon={<AlertTriangle className="w-5 h-5" />}
        />
        <StatCard
          title="Unhandled"
          value={unhandledCount}
          format="number"
          icon={<Shield className="w-5 h-5" />}
        />
        <StatCard
          title="Affected Users"
          value={affectedUsers}
          format="number"
          icon={<Globe className="w-5 h-5" />}
        />
      </div>

      {/* Per-project breakdown */}
      {stats?.projects && stats.projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {stats.projects.map((project) => (
            <div
              key={project.slug}
              className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-5 sm:p-7 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-white/10"
            >
              <div className="flex items-center gap-3 mb-3">
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

      {/* Error Trend Chart */}
      {stats?.errorTrend && stats.errorTrend.length > 0 && (
        <div className="mb-8">
          <ChartCard title="Error Trend" subtitle={`Events over the last ${dateRange}`}>
            <AreaChart
              data={stats.errorTrend.map((point) => ({
                date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                errors: point.errors,
              }))}
              xKey="date"
              yKey="errors"
              color="#ef4444"
            />
          </ChartCard>
        </div>
      )}

      {/* Issues Table */}
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
              <div key={i} className="animate-pulse h-20 rounded-xl bg-zinc-900/50" />
            ))}
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Shield className="w-12 h-12 mb-4 text-accent" />
            <p className="text-lg font-medium text-zinc-300">All clear</p>
            <p className="text-sm font-mono mt-1">No unresolved issues</p>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <a
                key={issue.id}
                href={`https://sentry.io/organizations/curious-minds-software/issues/${issue.id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-white/5 hover:border-white/10 bg-zinc-900/30 hover:bg-zinc-900/50 p-4 transition-all duration-200 group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-medium border ${getLevelColor(issue.level)}`}>
                        {issue.level}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono text-zinc-500 bg-zinc-800/50 border border-zinc-700/30">
                        {getPlatformIcon(issue.platform)}
                        {issue.project}
                      </span>
                      {issue.isUnhandled && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-medium text-red-400 bg-red-500/10 border border-red-500/20">
                          unhandled
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
                      {issue.type}: {issue.value || issue.title}
                    </p>
                    <p className="text-xs font-mono text-zinc-500 mt-1 truncate">
                      {issue.culprit}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-foreground">{issue.count.toLocaleString()}</p>
                      <p className="text-xs font-mono text-zinc-500">events</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-foreground">{issue.userCount}</p>
                      <p className="text-xs font-mono text-zinc-500">users</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="flex items-center gap-1 text-xs font-mono text-zinc-500">
                        <Clock className="w-3 h-3" />
                        {timeAgo(issue.lastSeen)}
                      </div>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
