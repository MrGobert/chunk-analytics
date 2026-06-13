'use client';

import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { MarketingMetrics } from '@/types/mixpanel';

// Marketing events are web-only and fire for anonymous visitors, so there is no
// platform or user-type selector here: the route is always queried with
// platform: 'all' and userType: 'all'. Filtering by userType would drop the
// logged-out visitors who make up nearly all marketing-site traffic, silently
// zeroing the page.

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center h-64 text-zinc-500 font-mono text-sm">
    {message}
  </div>
);

// A referrer/UTM source breakdown: a { source, sessions } table or an empty state.
const SourceCard = ({
  title,
  subtitle,
  headerLabel,
  data,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  headerLabel: string;
  data: { source: string; sessions: number }[];
  emptyMessage: string;
}) => (
  <ChartCard title={title} subtitle={subtitle}>
    {data.length > 0 ? (
      <DataTable
        data={data}
        columns={[
          { key: 'source', header: headerLabel },
          { key: 'sessions', header: 'Visits' },
        ]}
      />
    ) : (
      <EmptyState message={emptyMessage} />
    )}
  </ChartCard>
);

export default function MarketingPage() {
  const { dateRange, setDateRange } = useDashboardFilters();

  const { data: metrics, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<MarketingMetrics>('/api/metrics/marketing', {
      range: dateRange,
      platform: 'all',
      userType: 'all',
    });

  if (isLoading) {
    return <SkeletonPage statCards={4} chartCards={3} />;
  }

  if (!metrics) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500 mb-2">Failed to load landing page metrics.</p>
        {error && <p className="text-xs font-mono text-red-400/70">{error}</p>}
      </div>
    );
  }

  // Defaults guard against a stale sessionStorage payload from before this
  // shipped (useAnalytics serves cached data stale-while-revalidate, and an
  // older object won't have the new array/scalar fields).
  const {
    marketingSessions = 0,
    pageViews = 0,
    pagesPerSession = 0,
    newVisitors = 0,
    pageViewsTrend = null,
    newVisitorsDaily = [],
    pageViewDistribution = [],
    referrerDistribution = [],
    utmSourceDistribution = [],
    utmMediumDistribution = [],
    utmCampaignDistribution = [],
  } = metrics;

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Landing Pages"
        subtitle="How visitors land on and move through the marketing site"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* ─── Headline metrics ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Marketing Visits"
          value={marketingSessions}
          format="number"
          subtitle="30-min deduped sessions"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          }
        />
        <StatCard
          title="Page Views"
          value={pageViews}
          trend={pageViewsTrend}
          format="number"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Pages / Session"
          value={marketingSessions > 0 ? pagesPerSession : '—'}
          format="decimal"
          subtitle="Page views ÷ marketing visits"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="New Visitors"
          value={newVisitors}
          format="number"
          subtitle="Not seen in prior period"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          }
        />
      </div>

      {/* ─── New visitors over time (Q3) ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="New Visitors Over Time"
          subtitle="First seen this period vs the immediately-prior period"
        >
          {newVisitorsDaily.some((d) => d.newVisitors > 0) ? (
            <AreaChart
              data={newVisitorsDaily}
              xKey="date"
              yKey="newVisitors"
              color="#E84D2B"
            />
          ) : (
            <EmptyState message="No new-visitor data for this time range" />
          )}
        </ChartCard>
      </div>

      {/* ─── Which pages are visitors viewing? (Q1) ──────────────────────── */}
      <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
        <h2 className="text-xl font-bold text-foreground tracking-tight">Which Pages Are Visitors Viewing?</h2>
        <p className="text-sm text-zinc-500 mt-1">Marketing pages ranked by views, with unique visitors</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Page Views by Page" subtitle="Total views per marketing page">
          {pageViewDistribution.length > 0 ? (
            <BarChart
              data={pageViewDistribution.map((d) => ({ page: d.page, views: d.views }))}
              xKey="page"
              yKey="views"
              horizontal
            />
          ) : (
            <EmptyState message="No page view data available" />
          )}
        </ChartCard>
        <ChartCard title="Pages" subtitle="Views and unique visitors per page">
          {pageViewDistribution.length > 0 ? (
            <DataTable
              data={pageViewDistribution}
              columns={[
                { key: 'page', header: 'Page' },
                { key: 'views', header: 'Views' },
                { key: 'visitors', header: 'Unique Visitors' },
              ]}
            />
          ) : (
            <EmptyState message="No page view data available" />
          )}
        </ChartCard>
      </div>

      {/* ─── Where do visitors come from? (Q4) ───────────────────────────── */}
      <div className="mt-12 mb-8 border-t border-zinc-800 pt-8">
        <h2 className="text-xl font-bold text-foreground tracking-tight">Where Do Visitors Come From?</h2>
        <p className="text-sm text-zinc-500 mt-1">Referrers and campaign tags on the first session of each visit</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SourceCard
          title="Top Referrers"
          subtitle="Referring domain by marketing visits"
          headerLabel="Referrer"
          data={referrerDistribution}
          emptyMessage="No referrer data available"
        />
        <SourceCard
          title="Campaign Source (UTM)"
          subtitle="utm_source by marketing visits"
          headerLabel="utm_source"
          data={utmSourceDistribution}
          emptyMessage="No UTM source data — visits are mostly organic/direct"
        />
      </div>

      {(utmMediumDistribution.length > 0 || utmCampaignDistribution.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <SourceCard
            title="Campaign Medium (UTM)"
            subtitle="utm_medium by marketing visits"
            headerLabel="utm_medium"
            data={utmMediumDistribution}
            emptyMessage="No UTM medium data"
          />
          <SourceCard
            title="Campaigns (UTM)"
            subtitle="utm_campaign by marketing visits"
            headerLabel="utm_campaign"
            data={utmCampaignDistribution}
            emptyMessage="No UTM campaign data"
          />
        </div>
      )}
    </div>
  );
}
