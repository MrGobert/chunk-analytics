'use client';

import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage, SkeletonChartCard } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { UserMetrics, AdvancedMetrics, HelpCenterMetrics, PowerUserMetrics } from '@/types/mixpanel';
import { chart } from '@/lib/chartTheme';

function formatDuration(duration: number) {
  const mins = Math.floor(duration / 60);
  const secs = Math.round(duration % 60);
  return `${mins}m ${secs}s`;
}

const SEGMENT_COLORS: Record<string, string> = {
  Power: chart.primary,
  Core: chart.series[0],
  Casual: chart.series[1],
  Dormant: chart.series[7],
};

export default function EngagementPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: userMetrics, isLoading: isUsersLoading, isRefreshing: isUsersRefreshing, lastUpdated: usersLastUpdated } =
    useAnalytics<UserMetrics>('/api/metrics/users', { range: dateRange, platform, userType });
  const { data: advancedMetrics, isLoading: isAdvancedLoading, isRefreshing: isAdvancedRefreshing, lastUpdated: advancedLastUpdated } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', { range: dateRange, platform, userType });
  const { data: power } =
    useAnalytics<PowerUserMetrics>('/api/metrics/power-users', { range: dateRange, platform, userType });
  const { data: helpMetrics, isLoading: isHelpLoading } =
    useAnalytics<HelpCenterMetrics>('/api/metrics/help-center', { range: dateRange, platform, userType });

  const isLoading = isUsersLoading || isAdvancedLoading;
  const isRefreshing = isUsersRefreshing || isAdvancedRefreshing;
  const lastUpdated = advancedLastUpdated || usersLastUpdated;

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || !userMetrics || !advancedMetrics) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, userMetrics, advancedMetrics]);

  const userBreakdownData = useMemo(() => {
    if (!advancedMetrics) return [];
    return [
      { name: 'Paid', value: advancedMetrics.userBreakdown.paid },
      { name: 'Free', value: advancedMetrics.userBreakdown.free },
      { name: 'Guest', value: advancedMetrics.userBreakdown.guest },
    ];
  }, [advancedMetrics]);

  const segmentBars = useMemo(
    () => (power?.segments || []).map((s) => ({ segment: s.segment, count: s.count })),
    [power?.segments]
  );

  const topUsersData = useMemo(
    () => (power?.topUsers || []).map((u) => ({
      uid: u.uid,
      user: u.uid.length > 14 ? `${u.uid.slice(0, 14)}…` : u.uid,
      activeDays: u.activeDays,
      features: u.features,
      events: u.events,
      tier: u.subscriber ? 'Subscriber' : 'Free',
    })),
    [power?.topUsers]
  );

  if (isLoading) {
    return <SkeletonPage statCards={3} statCardCols="grid-cols-1 md:grid-cols-3" chartCards={4} />;
  }
  if (!userMetrics || !advancedMetrics) {
    return <div className="empty-state py-20">Failed to load metrics. Please try again.</div>;
  }

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Engagement"
        subtitle="Active users, session depth, and power-user segments"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="card-animate"><StatCard title="DAU/MAU Ratio" value={advancedMetrics.dauMauRatio} format="ratio" subtitle="Stickiness" /></div>
        <div className="card-animate"><StatCard title="Avg Session Duration" value={formatDuration(advancedMetrics.avgSessionDuration)} format="text" subtitle="Time in app" /></div>
        <div className="card-animate"><StatCard title="Searches per User" value={advancedMetrics.searchesPerUser} format="decimal" subtitle="Avg per user" /></div>
      </div>

      {/* DAU trend */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Daily Active Users" subtitle="DAU trend over selected period">
            <LineChart data={userMetrics.dau} xKey="date" lines={[{ key: 'users', color: chart.lake, name: 'Daily Active Users' }]} />
          </ChartCard>
        </div>
      </div>

      {/* WAU + MAU */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate"><ChartCard title="Weekly Active Users" subtitle="Unique users per week"><BarChart data={userMetrics.wau} xKey="week" yKey="users" color={chart.series[0]} /></ChartCard></div>
        <div className="card-animate"><ChartCard title="Monthly Active Users" subtitle="Unique users per month"><BarChart data={userMetrics.mau} xKey="month" yKey="users" color={chart.series[1]} /></ChartCard></div>
      </div>

      {/* ── Power users ─────────────────────────────────────────────────────── */}
      <div className="mt-4 mb-6">
        <h2 className="font-display text-2xl text-ink">Power Users</h2>
        <p className="text-sm text-ink-soft mt-1">Segment the active base by depth and frequency of use</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {(power?.segments || []).map((s) => (
          <div key={s.segment} className="card-animate card-surface p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEGMENT_COLORS[s.segment] || chart.series[0] }} />
              <span className="text-sm font-semibold text-ink-soft">{s.segment}</span>
            </div>
            <div className="font-mono text-3xl text-ink tabular-nums">{s.count}</div>
            <p className="text-xs text-ink-faint mt-1">{s.description}</p>
            <p className="text-xs font-mono text-sage-deep mt-1">{s.subscribers} subscriber{s.subscribers === 1 ? '' : 's'}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Segment Distribution" subtitle="Active base by engagement tier">
            {segmentBars.length > 0 ? (
              <BarChart data={segmentBars} xKey="segment" yKey="count" colors={segmentBars.map((s) => SEGMENT_COLORS[s.segment] || chart.series[0])} />
            ) : (
              <div className="empty-state h-full">Loading segments…</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Feature Breadth" subtitle="How many feature areas users touch">
            {power?.featureBreadth?.length ? (
              <BarChart data={power.featureBreadth} xKey="features" yKey="users" color={chart.series[1]} />
            ) : (
              <div className="empty-state h-full">No breadth data</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Top users table */}
      <div className="card-animate card-surface p-6 sm:p-8 mb-8">
        <div className="mb-6 border-b border-line pb-4">
          <h3 className="font-display text-xl sm:text-2xl text-ink">Top 50 Users</h3>
          <p className="text-sm font-mono text-ink-faint mt-2">By active days, then total events — click to view the customer</p>
        </div>
        <div className="h-[360px]">
          {topUsersData.length > 0 ? (
            <DataTable
              data={topUsersData}
              getRowHref={(r) => (r.uid ? `/customers/${r.uid}` : null)}
              columns={[
                { key: 'user', header: 'User' },
                { key: 'tier', header: 'Tier' },
                { key: 'activeDays', header: 'Active Days', numeric: true },
                { key: 'features', header: 'Features', numeric: true },
                { key: 'events', header: 'Events', numeric: true },
              ]}
            />
          ) : (
            <div className="empty-state h-full">No user activity in this period</div>
          )}
        </div>
      </div>

      {/* Session distributions + user breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate"><ChartCard title="Session Duration Distribution" subtitle="How long users stay in the app"><BarChart data={userMetrics.sessionDurations} xKey="range" yKey="count" /></ChartCard></div>
        <div className="card-animate"><ChartCard title="Sessions per User" subtitle="Number of sessions each user has"><BarChart data={userMetrics.sessionsPerUser} xKey="sessions" yKey="users" color={chart.series[0]} /></ChartCard></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-animate"><ChartCard title="User Breakdown" subtitle="Paid vs Free vs Guest users"><PieChart data={userBreakdownData} colors={[chart.sage, chart.series[0], chart.series[7]]} /></ChartCard></div>
        <div className="card-animate"><ChartCard title="Feature Adoption Rates" subtitle="Percentage of users who used each feature"><BarChart data={(advancedMetrics.featureAdoption || []).map((f) => ({ feature: f.feature, rate: Math.round((f.adoptionRate ?? 0) * 10) / 10 }))} xKey="feature" yKey="rate" color={chart.series[1]} horizontal /></ChartCard></div>
      </div>

      {/* ── Help Center ─────────────────────────────────────────────────────── */}
      {(helpMetrics || isHelpLoading) && (
        <>
          <div className="mt-12 mb-8 border-t border-line pt-8">
            <h2 className="font-display text-2xl text-ink">Help Center</h2>
            <p className="text-sm text-ink-soft mt-1">Which features and FAQs users seek help with most</p>
          </div>

          {helpMetrics ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="card-animate"><StatCard title="Help Page Views" value={helpMetrics.totalViews} trend={helpMetrics.viewsTrend} format="number" /></div>
                <div className="card-animate"><StatCard title="Unique Help Users" value={helpMetrics.uniqueUsers} trend={helpMetrics.uniqueUsersTrend} format="number" /></div>
                <div className="card-animate"><StatCard title="FAQ Opens" value={helpMetrics.faqOpens} trend={helpMetrics.faqOpensTrend} format="number" /></div>
                <div className="card-animate"><StatCard title="CTA Clicks" value={helpMetrics.ctaClicks} trend={helpMetrics.ctaClicksTrend} format="number" /></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="card-animate"><ChartCard title="Help Pages by Views" subtitle="Most visited help pages">{helpMetrics.pageViewDistribution.length > 0 ? <BarChart data={helpMetrics.pageViewDistribution} xKey="page" yKey="count" horizontal /> : <div className="empty-state h-full">No help page view data yet</div>}</ChartCard></div>
                <div className="card-animate"><ChartCard title="FAQ Categories" subtitle="Which help categories get the most interaction">{helpMetrics.faqCategoryDistribution.length > 0 ? <BarChart data={helpMetrics.faqCategoryDistribution} xKey="category" yKey="count" horizontal /> : <div className="empty-state h-full">No FAQ data yet</div>}</ChartCard></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card-animate"><ChartCard title="Top FAQ Questions" subtitle="Most opened FAQ entries">{helpMetrics.topFaqQuestions.length > 0 ? <DataTable data={helpMetrics.topFaqQuestions} columns={[{ key: 'question', header: 'Question' }, { key: 'category', header: 'Category' }, { key: 'count', header: 'Opens', numeric: true }]} /> : <div className="empty-state h-full">No FAQ question data yet</div>}</ChartCard></div>
                <div className="card-animate"><ChartCard title="Daily Help Center Activity" subtitle="Views, FAQ opens, and CTA clicks per day">{helpMetrics.dailyData.length > 0 ? <LineChart data={helpMetrics.dailyData} xKey="date" lines={[{ key: 'views', color: chart.series[0], name: 'Page Views' }, { key: 'faqOpens', color: chart.series[3], name: 'FAQ Opens' }, { key: 'ctaClicks', color: chart.primary, name: 'CTA Clicks' }]} showLegend /> : <div className="empty-state h-full">No daily data available</div>}</ChartCard></div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SkeletonChartCard />
              <SkeletonChartCard />
            </div>
          )}
        </>
      )}
    </div>
  );
}
