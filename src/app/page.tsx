'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import NorthStarHero from '@/components/pulse/NorthStarHero';
import AlertStrip, { type AlertItem } from '@/components/pulse/AlertStrip';
import TopMovers from '@/components/pulse/TopMovers';
import { SkeletonStatCard, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { AlertTriangle, Clock, Bug, CreditCard, Search, DollarSign, Wallet, Users2, UserPlus, Percent, TrendingDown, ArrowRight } from 'lucide-react';
import { RevenueSummary, ChurnIntelligence, PulseMetrics, SubscriberFunnel, SentryStats } from '@/types/mixpanel';
import { getDaysFromRange } from '@/lib/utils';
import { chart } from '@/lib/chartTheme';

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function PulsePage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const days = getDaysFromRange(dateRange);

  const { data: revenue, isLoading: revenueLoading, isRefreshing: revenueRefreshing, lastUpdated: revenueUpdated, error: revenueError } =
    useAnalytics<RevenueSummary>('/api/rc/revenue-summary', { days });
  const { data: churn } =
    useAnalytics<ChurnIntelligence>('/api/rc/churn-intelligence', { days });
  const { data: pulse, isLoading: pulseLoading } =
    useAnalytics<PulseMetrics>('/api/metrics/pulse', {});
  const { data: funnel } =
    useAnalytics<SubscriberFunnel>('/api/rc/subscriber-funnel', { days });
  const { data: sentry } =
    useAnalytics<SentryStats>('/api/sentry/stats', { statsPeriod: '7d', resolution: '1h' });

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || revenueLoading || !revenue) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.fromTo('.card-animate', { opacity: 0 }, { opacity: 1, duration: 0.3 });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [revenueLoading, revenue]);

  const mrrChartData = useMemo(() => (revenue?.mrrTrend || []).map((d) => ({ date: d.date, mrr: d.mrr })), [revenue?.mrrTrend]);
  const dauChartData = useMemo(() => (pulse?.dauTrend14d || pulse?.dauTrend7d || []).map((d) => ({ date: d.date, users: d.users })), [pulse?.dauTrend14d, pulse?.dauTrend7d]);

  // ── Sentry 24h vs prior-6-day daily average ──────────────────────────────
  const sentryDerived = useMemo(() => {
    const trend = sentry?.errorTrend || [];
    if (trend.length === 0) return { last24h: null as number | null, spike: false };
    const last24 = trend.slice(-24);
    const last24h = last24.reduce((s, p) => s + p.errors, 0);
    const prior = trend.slice(0, Math.max(0, trend.length - 24));
    const priorDailyAvg = prior.length > 0 ? (prior.reduce((s, p) => s + p.errors, 0) / (prior.length / 24)) : 0;
    const spike = last24h > 10 && priorDailyAvg > 0 && last24h > 2 * priorDailyAvg;
    return { last24h, spike };
  }, [sentry?.errorTrend]);

  // ── DAU vs same weekday last week ────────────────────────────────────────
  const dauTrend = useMemo(() => {
    if (!pulse) return undefined;
    const prev = pulse.sameWeekdayDAU;
    if (prev === 0) return pulse.todayDAU > 0 ? null : 0;
    return ((pulse.todayDAU - prev) / prev) * 100;
  }, [pulse]);

  // ── Alert strip ──────────────────────────────────────────────────────────
  const alerts = useMemo<AlertItem[]>(() => {
    const list: AlertItem[] = [];
    const trialsExpiring = (churn?.atRiskUsers || []).filter(
      (u) => u.subscriptionType === 'trial' && u.trialEndsIn != null && u.trialEndsIn <= 2 && u.trialEndsIn >= 0
    ).length;
    if (trialsExpiring > 0) {
      list.push({ id: 'trials', level: 'critical', icon: Clock, label: `${trialsExpiring} trial${trialsExpiring > 1 ? 's' : ''} expiring ≤48h`, detail: 'Reach out before they lapse', href: '/customers' });
    }
    if (pulse && pulse.todayPurchaseFailures > 0) {
      list.push({ id: 'purchasefail', level: 'critical', icon: CreditCard, label: `${pulse.todayPurchaseFailures} purchase failure${pulse.todayPurchaseFailures > 1 ? 's' : ''} today`, detail: 'Check billing / paywall', href: '/conversion' });
    }
    if (sentryDerived.spike && sentryDerived.last24h != null) {
      list.push({ id: 'sentry', level: 'critical', icon: Bug, label: `Error spike: ${sentryDerived.last24h} in 24h`, detail: 'Above 2× the weekly daily average', href: '/health' });
    }
    if (pulse && pulse.searchFailRateToday > 0.05 && pulse.searchFailRateToday > 2 * pulse.searchFailRate7d) {
      list.push({ id: 'searchfail', level: 'warning', icon: Search, label: `Search failure rate ${fmtPct(pulse.searchFailRateToday)}`, detail: 'Above 2× the 7-day rate', href: '/health' });
    }
    if (churn && churn.atRiskCount > 0) {
      list.push({ id: 'atrisk', level: 'warning', icon: AlertTriangle, label: `${churn.atRiskCount} at-risk customer${churn.atRiskCount > 1 ? 's' : ''}`, detail: 'Inactive 7+ days or trial ending soon', href: '/customers' });
    }
    return list;
  }, [churn, pulse, sentryDerived]);

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Pulse"
        subtitle="Daily briefing — how Chunk is doing today"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={revenueUpdated}
        isRefreshing={revenueRefreshing}
      />

      <p className="text-xs text-ink-faint -mt-2 mb-6">
        Revenue &amp; funnel cards follow the date range above; activity metrics (DAU, Weekly Active
        Creators, Top Movers) use fixed 7/14-day windows.
      </p>

      {revenue?.note && (
        <div className="mb-6 p-4 bg-butter-tint border border-butter rounded-card flex items-center gap-2 text-sm text-ink">
          <AlertTriangle className="w-5 h-5 text-[#C8922A] shrink-0" />
          <span>{revenue.note}</span>
        </div>
      )}

      {/* ── Alert strip (renders "all clear" when empty) ───────────────────── */}
      {(pulse || churn) && <AlertStrip alerts={alerts} />}

      {/* ── North-star hero + today snapshot ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="card-animate lg:col-span-2">
          {pulseLoading || !pulse ? (
            <SkeletonChartCard />
          ) : (
            <NorthStarHero value={pulse.weeklyActiveCreators} change={pulse.wacChange} trend={dauChartData} />
          )}
        </div>
        <div className="card-animate card-surface p-6 sm:p-8">
          <span className="eyebrow text-ink-faint">Today so far</span>
          <div className="mt-4 space-y-4">
            {[
              { label: 'New signups', value: pulse?.todaySignups ?? 0, icon: UserPlus },
              { label: 'Trials started', value: pulse?.todayTrialStarts ?? 0, icon: Clock },
              { label: 'Purchases', value: pulse?.todayPurchases ?? 0, icon: Wallet },
              { label: 'Paywalls viewed', value: pulse?.todayPaywallViews ?? 0, icon: CreditCard },
            ].map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-ink-soft">
                    <Icon className="w-4 h-4 text-ink-faint" />
                    <span className="text-sm">{row.label}</span>
                  </div>
                  <span className="font-mono text-lg text-ink tabular-nums">{row.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── KPI row (6-up) ─────────────────────────────────────────────────── */}
      {revenueLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      ) : revenueError ? (
        <div className="card-surface p-8 text-center mb-8">
          <div className="text-ember-deep mb-2 text-sm">{revenueError}</div>
          <p className="text-ink-faint text-xs font-mono">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
        </div>
      ) : revenue ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
          <StatCard title="MRR" value={revenue.mrr} format="currency" trend={revenue.mrrChange} icon={<DollarSign className="w-5 h-5" />} />
          <StatCard title="Today's Revenue" value={revenue.todayRevenue} format="currency" icon={<Wallet className="w-5 h-5" />} />
          <StatCard title="Active Subscribers" value={revenue.totalSubscribers} icon={<Users2 className="w-5 h-5" />} />
          <StatCard title="DAU" value={pulse?.todayDAU ?? 0} trend={dauTrend} subtitle="vs same weekday last week" icon={<UserPlus className="w-5 h-5" />} />
          <StatCard title="Trial Conversion" value={funnel ? funnel.trialConversionRate / 100 : 0} format="percentage" icon={<Percent className="w-5 h-5" />} />
          <StatCard title="Churn Rate" value={(revenue.churnRate ?? 0) / 100} format="percentage" invertTrend icon={<TrendingDown className="w-5 h-5" />} />
        </div>
      ) : null}

      {/* ── Charts (MRR ember, DAU lake) ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {revenueLoading ? <SkeletonChartCard /> : (
          <div className="card-animate">
            <ChartCard title="MRR Trend" subtitle={`Last ${days} days`}>
              {mrrChartData.length > 0 ? (
                <AreaChart data={mrrChartData} xKey="date" yKey="mrr" color={chart.primary} />
              ) : (
                <div className="empty-state h-full">No MRR trend data available yet</div>
              )}
            </ChartCard>
          </div>
        )}
        {pulseLoading ? <SkeletonChartCard /> : (
          <div className="card-animate">
            <ChartCard title="Daily Active Users" subtitle={`Last 14 days${pulse ? ` · Today: ${pulse.todayDAU}` : ''}`}>
              {dauChartData.length > 0 ? (
                <AreaChart data={dauChartData} xKey="date" yKey="users" color={chart.lake} />
              ) : (
                <div className="empty-state h-full">No DAU data available yet</div>
              )}
            </ChartCard>
          </div>
        )}
      </div>

      {/* ── Top movers + today's conversion micro-funnel ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-animate card-surface p-6 sm:p-8 lg:col-span-2">
          <h3 className="font-display text-xl text-ink mb-1">Top Movers</h3>
          <p className="text-sm font-mono text-ink-faint mb-5">Feature activity · last 7 days vs prior 7</p>
          {pulse?.topMovers ? (
            <TopMovers gainers={pulse.topMovers.gainers} decliners={pulse.topMovers.decliners} />
          ) : (
            <div className="empty-state py-8">Loading movers…</div>
          )}
        </div>

        <Link href="/conversion" className="group card-animate">
          <div className="card-surface card-hover p-6 sm:p-8 h-full">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-xl text-ink">Today&apos;s Funnel</h3>
              <ArrowRight className="w-5 h-5 text-ink-faint group-hover:text-ink transition-colors" />
            </div>
            {pulse?.microFunnel ? (
              <div className="space-y-3">
                {[
                  { label: 'Paywall viewed', value: pulse.microFunnel.paywallViewed },
                  { label: 'Plan selected', value: pulse.microFunnel.planSelected },
                  { label: 'Purchase started', value: pulse.microFunnel.purchaseInitiated },
                  { label: 'Purchased', value: pulse.microFunnel.purchaseCompleted },
                ].map((step, i, arr) => {
                  const top = arr[0].value || 1;
                  const w = Math.max((step.value / top) * 100, 6);
                  return (
                    <div key={step.label}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-ink-soft">{step.label}</span>
                        <span className="font-mono text-ink tabular-nums">{step.value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-paper-deep overflow-hidden">
                        <div className="h-full rounded-full bg-lake" style={{ width: `${w}%`, opacity: 1 - i * 0.18 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state py-8">Loading…</div>
            )}
          </div>
        </Link>
      </div>
    </div>
  );
}
