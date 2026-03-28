'use client';

import { useMemo, useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import FunnelChart from '@/components/charts/FunnelChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { RevenueSummary, SubscriberFunnel } from '@/types/mixpanel';
import { getDaysFromRange } from '@/lib/utils';

export default function RevenuePage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const days = getDaysFromRange(dateRange);

  const { data: revenue, isLoading: revenueLoading, isRefreshing: revenueRefreshing, error: revenueError, lastUpdated: revenueLastUpdated } =
    useAnalytics<RevenueSummary>('/api/rc/revenue-summary', { days });

  const { data: funnel, isLoading: funnelLoading, isRefreshing: funnelRefreshing, error: funnelError, lastUpdated: funnelLastUpdated } =
    useAnalytics<SubscriberFunnel>('/api/rc/subscriber-funnel', { days });

  const isLoading = revenueLoading || funnelLoading;
  const isRefreshing = revenueRefreshing || funnelRefreshing;
  const lastUpdated = revenueLastUpdated || funnelLastUpdated;

  // Revenue chart data
  const mrrChartData = useMemo(() =>
    (revenue?.mrrTrend || []).map((d) => ({ date: d.date, mrr: d.mrr })),
    [revenue?.mrrTrend]
  );

  const platformData = useMemo(() =>
    Object.entries(revenue?.byPlatform || {}).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    })),
    [revenue?.byPlatform]
  );

  const productData = useMemo(() =>
    Object.entries(revenue?.byProduct || {}).map(([product, amount]) => ({
      product: product.charAt(0).toUpperCase() + product.slice(1),
      revenue: amount,
    })),
    [revenue?.byProduct]
  );

  const breakdownTableData = useMemo(() => {
    const totalSubs = revenue?.totalSubscribers || 0;
    return Object.entries(revenue?.byProduct || {}).map(([product, amount]) => {
      const estimatedSubs = totalSubs > 0 ? Math.round(totalSubs * (amount / (revenue?.mrr || 1))) : 0;
      const arpu = estimatedSubs > 0 ? amount / estimatedSubs : 0;
      return {
        product: product.charAt(0).toUpperCase() + product.slice(1),
        mrr: `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subscribers: estimatedSubs.toString(),
        arpu: `$${arpu.toFixed(2)}`,
      };
    });
  }, [revenue?.byProduct, revenue?.totalSubscribers, revenue?.mrr]);

  // Funnel chart data
  const funnelData = useMemo(() =>
    (funnel?.funnel || []).map((step, index, arr) => ({
      name: step.stage,
      count: step.count,
      percentage: step.rate,
      dropoff: index > 0 ? arr[index - 1].rate - step.rate : 0,
    })),
    [funnel?.funnel]
  );

  const platformConversionData = useMemo(() =>
    Object.entries(funnel?.conversionByPlatform || {}).map(([platform, rate]) => ({
      platform: platform.charAt(0).toUpperCase() + platform.slice(1),
      rate,
    })),
    [funnel?.conversionByPlatform]
  );

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || (!revenue && !funnel)) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, revenue, funnel]);

  if (isLoading) {
    return <SkeletonPage statCards={5} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-5" chartCards={3} />;
  }

  if (revenueError && funnelError) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 mb-4">{revenueError}</div>
        <p className="text-zinc-500 text-sm">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
      </div>
    );
  }

  if (!revenue && !funnel) {
    return (
      <div className="text-center font-mono text-zinc-500 py-20 tracking-wide uppercase">
        Failed to load data. Please try again.
      </div>
    );
  }

  const netNewMrr = revenue ? revenue.netNew * (revenue.mrr / Math.max(revenue.totalSubscribers, 1)) : 0;
  const mrrGrowth = revenue?.mrrChange || 0;
  const wow = funnel?.weekOverWeek || { trialStarts: 0, conversions: 0 };

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Revenue & Subscriptions"
        subtitle="Revenue analytics, subscription metrics, and conversion funnel"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
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

      {/* Revenue Stat Cards */}
      {revenue && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <StatCard
            title="MRR"
            value={revenue.mrr}
            trend={mrrGrowth}
            format="currency"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="ARR"
            value={revenue.arr}
            format="currency"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
            title="Est. Net New MRR"
            value={netNewMrr}
            format="currency"
            icon={
              <svg className="w-5 h-5 text-[#34D399]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <StatCard
            title="MRR Growth"
            value={mrrGrowth / 100}
            format="percentage"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            }
          />
        </div>
      )}

      {/* MRR Trend Chart */}
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

      {/* Two-column: Revenue by Platform + Revenue by Product */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Revenue by Platform" subtitle="MRR distribution across platforms">
          {platformData.length > 0 ? (
            <PieChart
              data={platformData}
              colors={['#10b981', '#3b82f6', '#8b5cf6', '#f43f5e', '#f59e0b']}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No platform data available yet
            </div>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Product" subtitle="MRR breakdown by subscription tier">
          {productData.length > 0 ? (
            <BarChart
              data={productData}
              xKey="product"
              yKey="revenue"
              color="#10b981"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No product data available yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Revenue Breakdown Table */}
      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Revenue Breakdown" subtitle="Per-product metrics">
          {breakdownTableData.length > 0 ? (
            <DataTable
              data={breakdownTableData}
              columns={[
                { key: 'product', header: 'Product' },
                { key: 'mrr', header: 'MRR' },
                { key: 'subscribers', header: 'Subscribers' },
                { key: 'arpu', header: 'ARPU' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No revenue breakdown available yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* Section Divider — Conversion Funnel */}
      <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
        <h2 className="text-xl font-bold text-foreground tracking-tight">Conversion Funnel</h2>
        <p className="text-sm text-zinc-500 mt-1">Trial → Paid conversion metrics</p>
      </div>

      {/* Funnel Stat Cards */}
      {funnel && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Trial → Paid Rate"
            value={funnel.trialConversionRate / 100}
            format="percentage"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <StatCard
            title="Median Days to Convert"
            value={funnel.medianDaysToConvert.toFixed(1)}
            format="text"
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="Trial Starts WoW"
            value={wow.trialStarts}
            format="decimal"
            subtitle={wow.trialStarts >= 0 ? 'Up from last week' : 'Down from last week'}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
          />
          <StatCard
            title="Conversions WoW"
            value={wow.conversions}
            format="decimal"
            subtitle={wow.conversions >= 0 ? 'Up from last week' : 'Down from last week'}
            icon={
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>
      )}

      {/* Two-column: Subscriber Funnel + Conversion by Platform */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Subscriber Funnel" subtitle={`Conversion funnel — last ${days} days`}>
          {funnelData.length > 0 ? (
            <FunnelChart data={funnelData} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No funnel data available yet
            </div>
          )}
        </ChartCard>

        <ChartCard title="Conversion by Platform" subtitle="Trial-to-paid conversion rate per platform">
          {platformConversionData.length > 0 ? (
            <BarChart
              data={platformConversionData}
              xKey="platform"
              yKey="rate"
              color="#10b981"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No platform conversion data available yet
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
