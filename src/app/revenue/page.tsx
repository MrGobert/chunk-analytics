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
import { chart } from '@/lib/chartTheme';
import { DollarSign, TrendingUp, Wallet, Users2, Repeat, Percent, Clock, AlertTriangle } from 'lucide-react';

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

  const mrrChartData = useMemo(() => (revenue?.mrrTrend || []).map((d) => ({ date: d.date, mrr: d.mrr })), [revenue?.mrrTrend]);

  const platformData = useMemo(() =>
    Object.entries(revenue?.byPlatform || {}).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value })),
    [revenue?.byPlatform]
  );

  const productData = useMemo(() =>
    Object.entries(revenue?.byProduct || {}).map(([product, amount]) => ({ product: product.charAt(0).toUpperCase() + product.slice(1), revenue: amount })),
    [revenue?.byProduct]
  );

  // MRR movements: new vs churned vs net (estimated $ from counts × ARPU)
  const arpu = revenue && revenue.totalSubscribers > 0 ? revenue.mrr / revenue.totalSubscribers : 0;
  const movementsData = useMemo(() => {
    if (!revenue) return [];
    return [
      { type: 'New', value: Math.round(revenue.newSubscribers * arpu) },
      { type: 'Churned', value: -Math.round(revenue.churned * arpu) },
      { type: 'Net New', value: Math.round(revenue.netNew * arpu) },
    ];
  }, [revenue, arpu]);

  const breakdownTableData = useMemo(() => {
    const totalSubs = revenue?.totalSubscribers || 0;
    const subsByProduct = revenue?.subscribersByProduct;
    return Object.entries(revenue?.byProduct || {}).map(([product, amount]) => {
      // Prefer real per-plan counts from the backend; only fall back to apportioning
      // total subscribers by MRR share when they're unavailable.
      const realSubs = subsByProduct?.[product];
      const subs = realSubs != null
        ? realSubs
        : (totalSubs > 0 ? Math.round(totalSubs * (amount / (revenue?.mrr || 1))) : 0);
      const productArpu = subs > 0 ? amount / subs : 0;
      return {
        product: product.charAt(0).toUpperCase() + product.slice(1),
        mrr: `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subscribers: subs.toString(),
        arpu: `$${productArpu.toFixed(2)}`,
      };
    });
  }, [revenue?.byProduct, revenue?.totalSubscribers, revenue?.mrr, revenue?.subscribersByProduct]);

  // The backend funnel ends with a "Churned" stage, which isn't a continuation of
  // the signup → active flow. Keep it out of the funnel chart (whose dropoff math
  // assumes a monotonic descent) and surface it separately.
  const churnedStage = useMemo(
    () => (funnel?.funnel || []).find((s) => s.stage === 'Churned'),
    [funnel?.funnel]
  );
  const funnelData = useMemo(() =>
    (funnel?.funnel || [])
      .filter((s) => s.stage !== 'Churned')
      .map((step, index, arr) => ({
        name: step.stage,
        count: step.count,
        percentage: step.rate,
        dropoff: index > 0 ? arr[index - 1].rate - step.rate : 0,
      })),
    [funnel?.funnel]
  );

  const platformConversionData = useMemo(() =>
    Object.entries(funnel?.conversionByPlatform || {}).map(([platform, rate]) => ({ platform: platform.charAt(0).toUpperCase() + platform.slice(1), rate })),
    [funnel?.conversionByPlatform]
  );

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || (!revenue && !funnel)) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, revenue, funnel]);

  if (isLoading) {
    return <SkeletonPage statCards={6} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" chartCards={3} />;
  }

  if (revenueError && funnelError) {
    return (
      <div className="text-center py-20">
        <div className="text-ember-deep mb-4">{revenueError}</div>
        <p className="text-ink-faint text-sm font-mono">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
      </div>
    );
  }

  if (!revenue && !funnel) {
    return <div className="empty-state py-20">Failed to load data. Please try again.</div>;
  }

  const mrrGrowth = revenue?.mrrChange || 0;
  // LTV ≈ ARPU ÷ monthly churn rate. churnRate is computed over the selected window
  // (`days`), so normalize it to a 30-day (monthly) rate first — otherwise a 90-day
  // range would understate churn and massively inflate LTV.
  const periodChurn = (revenue?.churnRate ?? 0) / 100;
  const daysNum = Number(days) || 30;
  const monthlyChurn = daysNum > 0 ? periodChurn * (30 / daysNum) : periodChurn;
  const ltv = monthlyChurn > 0 ? arpu / monthlyChurn : null;

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Revenue"
        subtitle="MRR movements, plan mix, and unit economics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {revenue?.note && (
        <div className="mb-6 p-4 bg-butter-tint border border-butter rounded-card flex items-center gap-2 text-sm text-ink">
          <AlertTriangle className="w-5 h-5 text-[#C8922A] shrink-0" />
          <span>{revenue.note}</span>
        </div>
      )}

      {/* KPI row (6-up) */}
      {revenue && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
          <div className="card-animate"><StatCard title="MRR" value={revenue.mrr} trend={mrrGrowth} format="currency" icon={<DollarSign className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="ARR" value={revenue.arr} format="currency" icon={<TrendingUp className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="ARPU" value={arpu} format="currency" icon={<Users2 className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Est. LTV" value={ltv ?? '—'} format={ltv != null ? 'currency' : 'text'} subtitle="ARPU ÷ monthly churn" icon={<Repeat className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Active Subscribers" value={revenue.totalSubscribers} icon={<Users2 className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Today's Revenue" value={revenue.todayRevenue} format="currency" subtitle="Est. from tracked conversions" icon={<Wallet className="w-5 h-5" />} /></div>
        </div>
      )}

      {/* MRR trend (ember) */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="MRR Trend" subtitle={`Monthly recurring revenue — last ${days} days`}>
            {mrrChartData.length > 0 ? (
              <AreaChart data={mrrChartData} xKey="date" yKey="mrr" color={chart.primary} />
            ) : (
              <div className="empty-state h-full">No MRR trend data available yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* MRR movements + platform mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="MRR Movements" subtitle="Estimated $ from new vs churned subscribers">
            {movementsData.length > 0 ? (
              <BarChart
                data={movementsData}
                xKey="type"
                yKey="value"
                colors={[chart.sage, chart.emberDeep, chart.lake]}
              />
            ) : (
              <div className="empty-state h-full">No movement data</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Revenue by Platform" subtitle="MRR distribution across platforms">
            {platformData.length > 0 ? (
              <PieChart data={platformData} />
            ) : (
              <div className="empty-state h-full">No platform data available yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Product mix + breakdown table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Revenue by Product" subtitle="MRR by subscription tier (Monthly vs Yearly)">
            {productData.length > 0 ? (
              <BarChart data={productData} xKey="product" yKey="revenue" color={chart.series[0]} />
            ) : (
              <div className="empty-state h-full">No product data available yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Revenue Breakdown" subtitle="Per-product metrics">
            {breakdownTableData.length > 0 ? (
              <DataTable
                data={breakdownTableData}
                columns={[
                  { key: 'product', header: 'Product' },
                  { key: 'mrr', header: 'MRR', numeric: true },
                  { key: 'subscribers', header: 'Subs', numeric: true },
                  { key: 'arpu', header: 'ARPU', numeric: true },
                ]}
              />
            ) : (
              <div className="empty-state h-full">No revenue breakdown available yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Subscriber funnel section */}
      <div className="mt-12 mb-8 border-t border-line pt-8">
        <h2 className="font-display text-2xl text-ink">Subscriber Funnel</h2>
        <p className="text-sm text-ink-soft mt-1">Signup → trial → paid → active</p>
      </div>

      {funnel && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="card-animate"><StatCard title="Trial → Paid Rate" value={funnel.trialConversionRate / 100} format="percentage" icon={<Percent className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Median Days to Convert" value={funnel.medianDaysToConvert.toFixed(1)} format="text" icon={<Clock className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Trial Starts WoW" value={funnel.weekOverWeek.trialStarts} format="decimal" icon={<TrendingUp className="w-5 h-5" />} /></div>
          <div className="card-animate"><StatCard title="Conversions WoW" value={funnel.weekOverWeek.conversions} format="decimal" icon={<TrendingUp className="w-5 h-5" />} /></div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-animate">
          <ChartCard title="Subscriber Funnel" subtitle={`Signup → active — last ${days} days${churnedStage ? ` · ${churnedStage.count} churned` : ''}`}>
            {funnelData.length > 0 ? (
              <FunnelChart data={funnelData} />
            ) : (
              <div className="empty-state h-full">No funnel data available yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Conversion by Platform" subtitle="Trial-to-paid conversion rate per platform">
            {platformConversionData.length > 0 ? (
              <BarChart data={platformConversionData} xKey="platform" yKey="rate" color={chart.series[1]} />
            ) : (
              <div className="empty-state h-full">No platform conversion data available yet</div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
