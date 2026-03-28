'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import { SkeletonStatCard, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { AlertTriangle, Bug, ArrowRight } from 'lucide-react';
import { RevenueSummary, ChurnIntelligence, PulseMetrics } from '@/types/mixpanel';
import { getDaysFromRange } from '@/lib/utils';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PulsePage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const days = getDaysFromRange(dateRange);

  // Revenue data (MRR, subscribers, churn, etc.)
  const { data: revenue, isLoading: revenueLoading, isRefreshing: revenueRefreshing, lastUpdated: revenueUpdated, error: revenueError } =
    useAnalytics<RevenueSummary>('/api/rc/revenue-summary', { days });

  // Churn intelligence (at-risk count)
  const { data: churn, isLoading: churnLoading } =
    useAnalytics<ChurnIntelligence>('/api/rc/churn-intelligence', { days });

  // Pulse metrics (DAU, searches, DAU trend)
  const { data: pulse, isLoading: pulseLoading } =
    useAnalytics<PulseMetrics>('/api/metrics/pulse', {});

  // GSAP entrance animation (play once only)
  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || revenueLoading || !revenue) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [revenueLoading, revenue]);

  // Chart data
  const mrrChartData = useMemo(() => (revenue?.mrrTrend || []).map((d) => ({ date: d.date, mrr: d.mrr })), [revenue?.mrrTrend]);

  const dauChartData = (pulse?.dauTrend7d || []).map((d) => ({
    date: d.date,
    users: d.users,
  }));

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Pulse"
        subtitle="Daily briefing — Chunk AI"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={revenueUpdated}
        isRefreshing={revenueRefreshing}
      />

      {/* Warning banner */}
      {revenue?.note && (
        <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{revenue.note}</span>
          </div>
        </div>
      )}

      {/* ── Stat Cards (6-up) ─────────────────────────────────────────────── */}
      {revenueLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      ) : revenueError ? (
        <div className="text-center py-10 mb-8">
          <div className="text-red-400 mb-2 text-sm">{revenueError}</div>
          <p className="text-zinc-500 text-xs">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
        </div>
      ) : revenue ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
          <StatCard
            title="MRR"
            value={revenue.mrr}
            format="currency"
            trend={revenue.mrrChange}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="Today's Revenue"
            value={revenue.todayRevenue}
            format="currency"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />
          <StatCard
            title="Active Subscribers"
            value={revenue.totalSubscribers}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
          />
          <StatCard
            title="Trial Users"
            value={revenue.trialUsers}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
          />
          <StatCard
            title="Churn Rate"
            value={(revenue.churnRate ?? 0) / 100}
            format="percentage"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
            }
          />
          <StatCard
            title="At-Risk Users"
            value={churnLoading ? '...' : (churn?.atRiskCount ?? 0)}
            format={churnLoading ? 'text' : 'number'}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
        </div>
      ) : null}

      {/* ── Sparkline Charts (2-up) ───────────────────────────────────────── */}
      {revenueLoading && pulseLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <SkeletonChartCard />
          <SkeletonChartCard />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* MRR Trend */}
          {revenueLoading ? (
            <SkeletonChartCard />
          ) : (
            <ChartCard title="MRR Trend" subtitle={`Last ${days} days`}>
              {mrrChartData.length > 0 ? (
                <AreaChart data={mrrChartData} xKey="date" yKey="mrr" color="#10b981" />
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
                  No MRR trend data available yet
                </div>
              )}
            </ChartCard>
          )}

          {/* DAU Trend */}
          {pulseLoading ? (
            <SkeletonChartCard />
          ) : (
            <ChartCard
              title="Daily Active Users"
              subtitle={`Last 7 days${pulse ? ` \u00B7 Today: ${pulse.todayDAU}` : ''}`}
            >
              {dauChartData.length > 0 ? (
                <AreaChart data={dauChartData} xKey="date" yKey="users" color="#8b5cf6" />
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
                  No DAU data available yet
                </div>
              )}
            </ChartCard>
          )}
        </div>
      )}

      {/* ── Needs Attention ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/churn" className="group">
          <div className="card-animate bg-primary/60 backdrop-blur-xl border border-white/5 rounded-[1.5rem] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <span className="text-2xl font-bold font-mono text-foreground">
                    {churnLoading ? '...' : (churn?.atRiskCount ?? 0)}
                  </span>
                  <p className="text-sm font-medium text-zinc-400">At-risk users</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </div>
          </div>
        </Link>

        <Link href="/health" className="group">
          <div className="card-animate bg-primary/60 backdrop-blur-xl border border-white/5 rounded-[1.5rem] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Bug className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <span className="text-2xl font-bold font-mono text-foreground">--</span>
                  <p className="text-sm font-medium text-zinc-400">Sentry errors (24h)</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
