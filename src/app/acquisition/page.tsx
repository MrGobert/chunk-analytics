'use client';

import { useState } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { chart } from '@/lib/chartTheme';
import { Rocket, Globe, Share2, Monitor, Smartphone, Tablet, Laptop, Glasses, MousePointerClick, FileText, UserPlus, Lock } from 'lucide-react';
import type { AcquisitionFunnelMetrics, MarketingMetrics, AdvancedMetrics, ViralityMetrics } from '@/types/mixpanel';

const VIEW_TABS = [
  { key: 'funnel', label: 'Funnel', icon: Rocket },
  { key: 'website', label: 'Website', icon: Globe },
  { key: 'viral', label: 'Viral Loops', icon: Share2 },
] as const;
type ViewKey = (typeof VIEW_TABS)[number]['key'];

const PLATFORM_TABS = [
  { key: 'web', label: 'Web', description: 'Marketing site', icon: Monitor },
  { key: 'iOS', label: 'iOS', description: 'iPhone', icon: Smartphone },
  { key: 'iPadOS', label: 'iPadOS', description: 'iPad', icon: Tablet },
  { key: 'macOS', label: 'macOS', description: 'Mac', icon: Laptop },
  { key: 'visionOS', label: 'visionOS', description: 'Vision Pro', icon: Glasses },
] as const;
type PlatformKey = (typeof PLATFORM_TABS)[number]['key'];

export default function AcquisitionPage() {
  const { dateRange, setDateRange, userType, setUserType } = useDashboardFilters();
  const [view, setView] = useState<ViewKey>('funnel');
  const [platformGroup, setPlatformGroup] = useState<PlatformKey>('web');

  const { data: metrics, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<AcquisitionFunnelMetrics>('/api/metrics/acquisition', { range: dateRange, platform: platformGroup, userType });
  // Website view's "Top Pages" comes from web Page_Viewed data — fetch it for the
  // web platform explicitly so it doesn't disappear when the Funnel tab is on iOS/macOS.
  const { data: webAcq } =
    useAnalytics<AcquisitionFunnelMetrics>('/api/metrics/acquisition', { range: dateRange, platform: 'web', userType });
  const { data: marketing, isLoading: marketingLoading } =
    useAnalytics<MarketingMetrics>('/api/metrics/marketing', { range: dateRange, platform: 'all', userType: 'all' });
  const { data: advanced, isLoading: advancedLoading } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', { range: dateRange, platform: 'all', userType: 'all' });
  const { data: viral, isLoading: viralLoading } =
    useAnalytics<ViralityMetrics>('/api/metrics/virality', { range: dateRange });

  if (isLoading && view === 'funnel') {
    return <SkeletonPage statCards={4} chartCards={2} />;
  }

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Acquisition"
        subtitle="How new users find, try, and spread Chunk"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Top-level view tabs */}
      <div className="flex gap-1 p-1 rounded-btn bg-card border border-line shadow-card mb-8 w-fit">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-chip text-sm font-medium transition-all duration-200 ${
                active ? 'bg-ember-deep text-[#FFF8F2]' : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Surface a fetch error on every tab so a failure is never a silent blank. */}
      {error && (
        <div className="mb-8 p-4 bg-ember-tint border border-ember/30 rounded-card text-ember-deep text-sm">
          {error}
        </div>
      )}

      {/* ═══ FUNNEL VIEW ═══════════════════════════════════════════════════ */}
      {view === 'funnel' && metrics && (
        <>
          {/* Platform tabs */}
          <div className="flex flex-wrap gap-2 mb-8">
            {PLATFORM_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = platformGroup === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setPlatformGroup(tab.key)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-btn text-sm font-medium transition-all duration-200 border ${
                    active ? 'bg-ember-tint text-ember-deep border-ember/20' : 'bg-card text-ink-soft border-line hover:bg-paper-deep hover:text-ink'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <div className="text-left">
                    <div className="leading-tight">{tab.label}</div>
                    <div className={`text-[10px] leading-tight ${active ? 'text-ember-deep/70' : 'text-ink-faint'}`}>{tab.description}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {metrics.statCards.map((card) => (
              <StatCard key={card.label} title={card.label} value={card.value} format={card.format ?? 'percentage'} icon={<Rocket className="w-5 h-5" />} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 mb-8">
            <ChartCard title={`${PLATFORM_TABS.find((t) => t.key === platformGroup)?.label} Acquisition Funnel`} subtitle={metrics.subtitle}>
              {metrics.funnel.some((s) => s.count > 0) ? <FunnelChart data={metrics.funnel} /> : <div className="empty-state h-64">No funnel data for this platform and time range</div>}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <ChartCard title="Daily Funnel Activity" subtitle="Unique users per funnel stage per day">
              {metrics.dailyData.length > 0 ? <LineChart data={metrics.dailyData} xKey="date" lines={metrics.dailyLines} showLegend /> : <div className="empty-state h-64">No daily data available</div>}
            </ChartCard>
          </div>

          {metrics.webPageAttribution && (
            <>
              <div className="mt-12 mb-8 border-t border-line pt-8">
                <h2 className="font-display text-2xl text-ink">Signup Page Attribution</h2>
                <p className="text-sm text-ink-soft mt-1">Which marketing page a visitor last viewed before creating an account</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Signups by Source Page" subtitle="Last marketing page viewed before signup">
                  {metrics.webPageAttribution.some((row) => row.signups > 0) ? (
                    <BarChart data={metrics.webPageAttribution.filter((row) => row.signups > 0)} xKey="page" yKey="signups" horizontal />
                  ) : <div className="empty-state h-64">Attribution begins with newly tracked signups</div>}
                </ChartCard>
                <ChartCard title="Page Conversion" subtitle="Visits, signups, and resulting subscriptions">
                  <DataTable
                    data={metrics.webPageAttribution}
                    columns={[
                      { key: 'page', header: 'Marketing page' },
                      { key: 'visits', header: 'Visits', numeric: true },
                      { key: 'signups', header: 'Signups', numeric: true },
                      { key: 'subscriptions', header: 'Subs', numeric: true },
                    ]}
                  />
                </ChartCard>
              </div>
            </>
          )}

          {metrics.appleOnboarding && (
            <>
              <div className="mt-12 mb-8 border-t border-line pt-8">
                <h2 className="font-display text-2xl text-ink">Paper Onboarding Detail</h2>
                <p className="text-sm text-ink-soft mt-1">Per-screen reach and explicit skip points on {PLATFORM_TABS.find((tab) => tab.key === platformGroup)?.label}</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Screen Progression" subtitle="Unique users reaching each PaperOnboarding screen">
                  {metrics.appleOnboarding.screenFunnel.some((step) => step.count > 0) ? <FunnelChart data={metrics.appleOnboarding.screenFunnel} /> : <div className="empty-state h-64">No PaperOnboarding events yet</div>}
                </ChartCard>
                <ChartCard title="Skip Points" subtitle="Screens where users explicitly skipped ahead">
                  {metrics.appleOnboarding.skipPoints.length > 0 ? <BarChart data={metrics.appleOnboarding.skipPoints} xKey="screen" yKey="users" horizontal color={chart.emberDeep} /> : <div className="empty-state h-64">No skips recorded</div>}
                </ChartCard>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <ChartCard title="Authentication Method" subtitle="Apple vs. email at the onboarding gate">
                  {metrics.appleOnboarding.authMethods.length > 0 ? <BarChart data={metrics.appleOnboarding.authMethods} xKey="method" yKey="users" horizontal /> : <div className="empty-state h-64">No completed authentication events yet</div>}
                </ChartCard>
              </div>
            </>
          )}
        </>
      )}

      {view === 'funnel' && !metrics && (
        <div className="empty-state py-20">Failed to load acquisition metrics.</div>
      )}

      {/* ═══ WEBSITE VIEW ══════════════════════════════════════════════════ */}
      {view === 'website' && (
        <>
          {webAcq?.topPages && webAcq.topPages.length > 0 && (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-ink">Top Pages</h2>
                <p className="text-sm text-ink-soft mt-1">Most visited pages from the marketing site</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                <ChartCard title="Page Visit Distribution" subtitle="Feature and marketing pages by visit count">
                  <BarChart data={webAcq.topPages.map((d) => ({ page: d.page.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), visits: d.visits }))} xKey="page" yKey="visits" horizontal />
                </ChartCard>
                <ChartCard title="Page Visits" subtitle="Ranked by total visits">
                  <DataTable data={webAcq.topPages.map((d) => ({ page: d.page.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), visits: d.visits }))} columns={[{ key: 'page', header: 'Page' }, { key: 'visits', header: 'Visits', numeric: true }]} />
                </ChartCard>
              </div>
            </>
          )}

          {marketing ? (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-ink">Marketing &amp; Conversion</h2>
                <p className="text-sm text-ink-soft mt-1">CTA performance and conversion triggers</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard title="CTA Clicks" value={marketing.totalCTAClicks} trend={marketing.ctaClicksTrend} format="number" icon={<MousePointerClick className="w-5 h-5" />} />
                <StatCard title="Feature Page Visits" value={marketing.featurePagesVisited} trend={marketing.featurePagesTrend} format="number" icon={<FileText className="w-5 h-5" />} />
                <StatCard title="Guest Prompts" value={marketing.guestSignupPrompts} trend={marketing.guestPromptsTrend} format="number" icon={<UserPlus className="w-5 h-5" />} />
                <StatCard title="Feature Limits Hit" value={marketing.featureLimitReached} format="number" icon={<Lock className="w-5 h-5" />} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                <ChartCard title="CTA Source Distribution" subtitle="Where CTA clicks originate">
                  {marketing.ctaSourceDistribution.length > 0 ? <BarChart data={marketing.ctaSourceDistribution} xKey="source" yKey="count" horizontal /> : <div className="empty-state h-64">No CTA source data available</div>}
                </ChartCard>
                <ChartCard title="Feature Limit Distribution" subtitle="Which features trigger limit prompts">
                  {marketing.featureLimitDistribution.length > 0 ? <BarChart data={marketing.featureLimitDistribution} xKey="feature" yKey="count" horizontal color={chart.primary} /> : <div className="empty-state h-64">No feature limit data available</div>}
                </ChartCard>
              </div>
            </>
          ) : marketingLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12"><SkeletonChartCard /><SkeletonChartCard /></div>
          ) : null}

          {advanced ? (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-ink">Traffic Sources</h2>
                <p className="text-sm text-ink-soft mt-1">Where users come from</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Referrer Domains" subtitle="Top traffic sources by session count">
                  {advanced.trafficSources.length > 0 ? <DataTable data={advanced.trafficSources as { source: string; sessions: number }[]} columns={[{ key: 'source', header: 'Source' }, { key: 'sessions', header: 'Sessions', numeric: true }]} /> : <div className="empty-state h-64">No referrer data available</div>}
                </ChartCard>
                <ChartCard title="UTM Campaigns" subtitle="Campaign performance by sessions">
                  {advanced.utmSources.length > 0 ? <DataTable data={advanced.utmSources as { campaign: string; sessions: number }[]} columns={[{ key: 'campaign', header: 'Campaign' }, { key: 'sessions', header: 'Sessions', numeric: true }]} /> : <div className="empty-state h-64">No UTM campaign data available</div>}
                </ChartCard>
              </div>
            </>
          ) : advancedLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChartCard /><SkeletonChartCard /></div>
          ) : null}
        </>
      )}

      {/* ═══ VIRAL LOOPS VIEW ══════════════════════════════════════════════ */}
      {view === 'viral' && (
        viralLoading || !viral ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChartCard /><SkeletonChartCard /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <StatCard title="Shares Created" value={viral.kpis.sharesCreated} icon={<Share2 className="w-5 h-5" />} />
              <StatCard title="Shared Views" value={viral.kpis.sharedViews} icon={<Globe className="w-5 h-5" />} />
              <StatCard title="Views per Share" value={viral.kpis.viewsPerShare} format="decimal" subtitle="Reach amplification" />
              <StatCard title="Viral Signups" value={viral.kpis.viralSignups} subtitle="Viewers who signed up" icon={<UserPlus className="w-5 h-5" />} />
            </div>

            <div className="mb-4 p-4 rounded-card border border-line bg-paper-deep/60 text-sm text-ink-soft">
              Viral attribution is same-device only — a viewer must reach signup on the same browser session for the loop to be credited.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <ChartCard title="Virality Funnel" subtitle="Share → view → save-to-Chunk → signup">
                <FunnelChart data={viral.funnel} />
              </ChartCard>
              <ChartCard title="Reach by Content Type" subtitle="Views generated per content type">
                {viral.byType.length > 0 ? <BarChart data={viral.byType.map((t) => ({ type: t.type, views: t.views }))} xKey="type" yKey="views" horizontal color={chart.series[0]} /> : <div className="empty-state h-64">No sharing data yet</div>}
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-6">
              <ChartCard title="Sharing Activity Over Time" subtitle="Shares, views, and saves per day">
                <LineChart
                  data={viral.dailyData}
                  xKey="date"
                  lines={[
                    { key: 'shares', color: chart.series[1], name: 'Shares' },
                    { key: 'views', color: chart.series[0], name: 'Views' },
                    { key: 'saves', color: chart.primary, name: 'Saves' },
                  ]}
                  showLegend
                />
              </ChartCard>
            </div>
          </>
        )
      )}
    </div>
  );
}
