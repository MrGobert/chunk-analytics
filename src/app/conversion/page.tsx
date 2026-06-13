'use client';

import { useMemo, useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import LineChart from '@/components/charts/LineChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { MonetizationMetrics, SubscriberFunnel } from '@/types/mixpanel';
import { getDaysFromRange } from '@/lib/utils';
import { chart } from '@/lib/chartTheme';
import { CreditCard, ShoppingCart, Percent, XCircle, AlertOctagon, Clock } from 'lucide-react';

export default function ConversionPage() {
  const { dateRange, setDateRange, platform, setPlatform } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const days = getDaysFromRange(dateRange);

  const { data, isLoading, isRefreshing, lastUpdated, error } =
    useAnalytics<MonetizationMetrics>('/api/metrics/monetization', { range: dateRange, platform });
  const { data: funnel } =
    useAnalytics<SubscriberFunnel>('/api/rc/subscriber-funnel', { days });

  const platformConversion = useMemo(
    () => (data?.byPlatform || []).map((p) => ({ platform: p.platform, rate: p.conversion * 100 })),
    [data?.byPlatform]
  );

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || !data) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, data]);

  if (isLoading) {
    return <SkeletonPage statCards={6} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" chartCards={3} />;
  }

  if (error || !data) {
    return <div className="empty-state py-20">{error || 'Failed to load monetization data.'}</div>;
  }

  const dailyLines = [
    { key: 'paywallViewed', color: chart.series[6], name: 'Paywall Viewed' },
    { key: 'planSelected', color: chart.series[0], name: 'Plan Selected' },
    { key: 'purchaseStarted', color: chart.series[1], name: 'Purchase Started' },
    { key: 'purchased', color: chart.primary, name: 'Purchased' },
  ];

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Conversion"
        subtitle="Paywall → plan → purchase, and what drives upgrades"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
        <div className="card-animate"><StatCard title="Paywall Views" value={data.kpis.paywallViews} icon={<CreditCard className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Purchases" value={data.kpis.purchases} icon={<ShoppingCart className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Overall Conversion" value={data.kpis.overallConversion} format="percentage" icon={<Percent className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Trial → Paid" value={funnel ? funnel.trialConversionRate / 100 : 0} format="percentage" icon={<Percent className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Dismissal Rate" value={data.kpis.dismissalRate} format="percentage" invertTrend icon={<XCircle className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Median Days to Pay" value={funnel ? funnel.medianDaysToConvert.toFixed(1) : '—'} format="text" icon={<Clock className="w-5 h-5" />} /></div>
      </div>

      {/* Funnel + plan mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Purchase Funnel" subtitle="Unique users · paywall → purchase">
            <FunnelChart data={data.funnel} />
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Plan Selection Mix" subtitle="Which plans users pick">
            {data.planMix.length > 0 ? (
              <PieChart data={data.planMix} />
            ) : (
              <div className="empty-state h-full">No plan selections yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Conversion by platform + paywall sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Conversion by Platform" subtitle="Paywall view → purchase, %">
            {platformConversion.length > 0 ? (
              <BarChart data={platformConversion} xKey="platform" yKey="rate" color={chart.series[1]} />
            ) : (
              <div className="empty-state h-full">No platform data</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Paywall Triggers" subtitle="Where the paywall is shown from">
            {data.paywallSources.length > 0 ? (
              <BarChart data={data.paywallSources} xKey="source" yKey="count" horizontal color={chart.series[0]} />
            ) : (
              <div className="empty-state h-full">No source data</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Feature limit drivers + daily volumes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Upgrade Drivers" subtitle="Feature limits that push users to the paywall">
            {data.featureLimits.length > 0 ? (
              <BarChart data={data.featureLimits} xKey="feature" yKey="count" horizontal color={chart.primary} />
            ) : (
              <div className="empty-state h-full">No limit events yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Funnel Over Time" subtitle="Daily unique users per stage">
            <LineChart data={data.dailyData} xKey="date" lines={dailyLines} showLegend />
          </ChartCard>
        </div>
      </div>

      {/* Failures table */}
      {(data.kpis.failures > 0 || data.kpis.cancellations > 0) && (
        <div className="grid grid-cols-1 gap-6">
          <div className="card-animate">
            <ChartCard title="Purchase Problems" subtitle="Failed and cancelled purchases this period" bodyClassName="h-auto">
              <DataTable
                data={[
                  { type: 'Purchase Failed', count: data.kpis.failures, severity: 'high' },
                  { type: 'Purchase Cancelled', count: data.kpis.cancellations, severity: 'low' },
                ]}
                columns={[
                  { key: 'type', header: 'Type' },
                  { key: 'count', header: 'Count', numeric: true },
                  {
                    key: 'severity',
                    header: 'Signal',
                    render: (v) =>
                      v === 'high' ? (
                        <span className="inline-flex items-center gap-1 text-ember-deep">
                          <AlertOctagon className="w-4 h-4" /> Investigate billing
                        </span>
                      ) : (
                        <span className="text-ink-soft">User-initiated</span>
                      ),
                  },
                ]}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
