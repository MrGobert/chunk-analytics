'use client';

import { useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import { SkeletonStatCard, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';

interface RevenueSummary {
  mrr: number;
  mrrChange: number;
  arr: number;
  todayRevenue: number;
  totalSubscribers: number;
  trialUsers: number;
  churnRate: number;
  byPlatform: Record<string, number>;
  byProduct: Record<string, number>;
  mrrTrend: { date: string; mrr: number }[];
  newSubscribers: number;
  churned: number;
  netNew: number;
  lastUpdated: string;
  note?: string;
}

interface SubscriberFunnel {
  funnel: { stage: string; count: number; rate: number }[];
  trialConversionRate: number;
  medianDaysToConvert: number;
  conversionByPlatform: Record<string, number>;
  weekOverWeek: { trialStarts: number; conversions: number };
  lastUpdated: string;
  note?: string;
}

interface EmailStats {
  totals: {
    sent: number;
    converted: number;
    overallConversionRate: number;
  };
  by_email_type: Record<string, { sent: number; converted: number; conversionRate: number }>;
  lastUpdated: string;
  note?: string;
}

export default function OverviewPage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const daysMap: Record<string, string> = { '7d': '7', '30d': '30', '90d': '90' };
  const days = daysMap[dateRange] || '30';

  const { data: revenue, isLoading: revenueLoading, isRefreshing: revenueRefreshing, lastUpdated: revenueUpdated, error: revenueError } =
    useAnalytics<RevenueSummary>('/api/rc/revenue-summary', { days });

  const { data: funnel, isLoading: funnelLoading, error: funnelError } =
    useAnalytics<SubscriberFunnel>('/api/rc/subscriber-funnel', { days });

  const { data: emailStats, isLoading: emailsLoading, error: emailsError } =
    useAnalytics<EmailStats>('/api/metrics/emails', { days });

  useEffect(() => {
    if (!revenueLoading && revenue) {
      const ctx = gsap.context(() => {
        gsap.fromTo('.card-animate',
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, [revenueLoading, revenue]);

  // Format MRR trend for chart
  const mrrChartData = (revenue?.mrrTrend || []).map((d) => ({
    date: d.date,
    mrr: d.mrr,
  }));

  // Build funnel data for the mini funnel
  const funnelData = (funnel?.funnel || []).map((step, index, arr) => ({
    name: step.stage,
    count: step.count,
    percentage: step.rate,
    dropoff: index > 0 ? arr[index - 1].rate - step.rate : 0,
  }));

  // Build email campaign summary data
  const emailCampaignData = Object.entries(emailStats?.by_email_type || {})
    .map(([type, data]) => ({
      type: type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      sent: data.sent || 0,
      converted: data.converted || 0,
    }))
    .filter((d) => d.sent > 0)
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 6);

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Command Center"
        subtitle="Chunk AI — Key business metrics at a glance"
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

      {/* Hero Row — Key Business Metrics */}
      {revenueLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      ) : revenueError ? (
        <div className="text-center py-10 mb-8">
          <div className="text-red-400 mb-2 text-sm">{revenueError}</div>
          <p className="text-zinc-500 text-xs">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
        </div>
      ) : revenue ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
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
        </div>
      ) : null}

      {/* MRR Trend Chart */}
      {revenueLoading ? (
        <div className="grid grid-cols-1 gap-6 mb-8">
          <SkeletonChartCard />
        </div>
      ) : revenue ? (
        <div className="grid grid-cols-1 gap-6 mb-8">
          <ChartCard title="MRR Trend" subtitle={`Monthly recurring revenue — last ${days} days`}>
            {mrrChartData.length > 0 ? (
              <AreaChart data={mrrChartData} xKey="date" yKey="mrr" color="#10b981" />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
                No MRR trend data available yet
              </div>
            )}
          </ChartCard>
        </div>
      ) : null}

      {/* Two-column: Funnel Mini + Email Campaign Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {funnelLoading ? (
          <SkeletonChartCard />
        ) : funnelError ? (
          <div className="rounded-xl bg-primary border border-zinc-800 p-6 flex items-center justify-center text-red-400 text-sm">
            {funnelError}
          </div>
        ) : (
          <ChartCard title="Subscriber Funnel" subtitle="Signup → Trial → Paid → Active">
            {funnelData.length > 0 ? (
              <FunnelChart data={funnelData} />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
                No funnel data available yet
              </div>
            )}
          </ChartCard>
        )}

        {emailsLoading ? (
          <SkeletonChartCard />
        ) : emailsError ? (
          <div className="rounded-xl bg-primary border border-zinc-800 p-6 flex items-center justify-center text-red-400 text-sm">
            {emailsError}
          </div>
        ) : (
          <ChartCard title="Email Campaign Performance" subtitle="Send volume by campaign type">
            {emailCampaignData.length > 0 ? (
              <BarChart
                data={emailCampaignData}
                xKey="type"
                yKey="sent"
                horizontal
                color="#10b981"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
                No email campaign data available yet
              </div>
            )}
          </ChartCard>
        )}
      </div>

      {/* Quick stats row */}
      {revenueLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      ) : revenue ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="New Subscribers"
            value={revenue.newSubscribers}
            subtitle={`Last ${days} days`}
            icon={
              <svg className="w-5 h-5 text-[#34D399]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <StatCard
            title="Churned"
            value={revenue.churned}
            subtitle={`Last ${days} days`}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
            }
          />
          <StatCard
            title="Net New"
            value={revenue.netNew}
            subtitle={`Last ${days} days`}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
