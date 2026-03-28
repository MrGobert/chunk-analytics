'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { getDaysFromRange } from '@/lib/utils';
import type { ChurnIntelligence, AdvancedMetrics } from '@/types/mixpanel';

export default function ChurnRetentionPage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const [churnSearch, setChurnSearch] = useState('');

  const days = getDaysFromRange(dateRange, '90');

  const { data: churn, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<ChurnIntelligence>('/api/rc/churn-intelligence', { days });

  const { data: advanced } =
    useAnalytics<AdvancedMetrics>('/api/metrics/advanced', { range: dateRange, platform: 'all', userType: 'all' });

  // Churn rate trend for line chart
  const churnTrendData = useMemo(() =>
    (churn?.churnRateTrend || []).map((d) => ({ date: d.date, rate: d.rate })),
    [churn?.churnRateTrend]
  );

  // At-risk users — sorted by health score ascending (worst first)
  const atRiskTableData = useMemo(() => {
    const users = [...(churn?.atRiskUsers || [])];
    users.sort((a, b) => (a.healthScore ?? -1) - (b.healthScore ?? -1));
    return users.map((u) => ({
      email: u.email || u.uid,
      type: u.subscriptionType === 'trial'
        ? `Trial${u.trialEndsIn != null ? ` (${u.trialEndsIn}d left)` : ''}`
        : 'Active',
      health: u.healthScore.toString(),
      lastActive: u.daysSinceActive != null ? `${u.daysSinceActive}d ago` : 'Never',
      platform: u.platform,
    }));
  }, [churn?.atRiskUsers]);

  // Engaged users table data
  const engagedTableData = useMemo(() => {
    const users = [...(churn?.topEngagedUsers || [])];
    users.sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));
    return users.map((u) => ({
      email: u.email || u.uid,
      health: u.healthScore.toString(),
      searches: (u.usage?.searches ?? 0).toString(),
      notes: (u.usage?.notes ?? 0).toString(),
      lastActive: u.daysSinceActive != null ? `${u.daysSinceActive}d ago` : 'N/A',
      platform: u.platform,
    }));
  }, [churn?.topEngagedUsers]);

  // Churned users filtered by search
  const churnedTableData = useMemo(() => {
    let users = churn?.churnedUsers || [];
    if (churnSearch) {
      const q = churnSearch.toLowerCase();
      users = users.filter((u) =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || '').toLowerCase().includes(q)
      );
    }
    return users.map((u) => ({
      email: u.email || u.uid,
      churnDate: u.churnDate,
      tenure: `${u.tenure}d`,
      searches: u.usage?.searches?.toString() || '0',
      notes: u.usage?.notes?.toString() || '0',
      platform: u.platform,
      emailsReceived: (u.emailsReceived || []).length.toString(),
    }));
  }, [churn?.churnedUsers, churnSearch]);

  // Winback effectiveness bar chart data
  const winbackData = useMemo(() =>
    Object.entries(churn?.winbackEffectiveness || {}).map(([type, stats]) => ({
      type: type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      rate: stats.rate,
    })),
    [churn?.winbackEffectiveness]
  );

  useEffect(() => {
    if (!isLoading && churn && !hasAnimated.current) {
      hasAnimated.current = true;
      const ctx = gsap.context(() => {
        gsap.fromTo('.card-animate',
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power3.out' }
        );
      }, containerRef);
      return () => ctx.revert();
    }
  }, [isLoading, churn]);

  if (isLoading) {
    return <SkeletonPage statCards={4} statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-4" chartCards={3} />;
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 mb-4">{error}</div>
        <p className="text-zinc-500 text-sm">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
      </div>
    );
  }

  if (!churn) {
    return (
      <div className="text-center font-mono text-zinc-500 py-20 tracking-wide uppercase">
        Failed to load churn data. Please try again.
      </div>
    );
  }

  const dataUnavailable = churn.dataUnavailable === true;

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Churn & Retention"
        subtitle="Monitor churn, retention, and at-risk users"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* Data unavailable banner */}
      {dataUnavailable && churn.note && (
        <div className="mb-6 p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg">
          <div className="flex items-center gap-3 text-amber-400">
            <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold text-sm">Data Temporarily Unavailable</p>
              <p className="text-amber-400/80 text-xs mt-1">{churn.note}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Monthly Churn Rate"
          value={dataUnavailable ? '—' : churn.churnRate / 100}
          format={dataUnavailable ? 'text' : 'percentage'}
        />
        <StatCard
          title="At-Risk Users"
          value={dataUnavailable ? '—' : (churn.atRiskCount || (churn.atRiskUsers || []).length)}
          format={dataUnavailable ? 'text' : undefined}
          subtitle={churn.trialAtRiskCount ? `${churn.trialAtRiskCount} trials expiring` : undefined}
        />
        <StatCard
          title="Winback Rate"
          value={dataUnavailable ? '—' : churn.winbackRate / 100}
          format={dataUnavailable ? 'text' : 'percentage'}
        />
        <StatCard
          title="Avg Tenure Before Churn"
          value={dataUnavailable ? '—' : `${churn.avgTenureBeforeChurn}d`}
          format="text"
        />
      </div>

      {/* Retention & Stickiness */}
      {advanced && (
        <div className="mt-2 mb-8">
          <h2 className="text-xl font-bold text-foreground tracking-tight mb-1">Retention & Stickiness</h2>
          <p className="text-sm text-zinc-500 mb-6">How well users stick around after their first session</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <StatCard title="DAU/MAU Ratio" value={advanced?.dauMauRatio ?? 0} format="ratio" subtitle="Stickiness" />
            <StatCard title="Day 1 Retention" value={(advanced?.retention?.day1 ?? 0) / 100} format="percentage" subtitle="Return next day" />
            <StatCard title="Day 7 Retention" value={(advanced?.retention?.day7 ?? 0) / 100} format="percentage" subtitle="Return within a week" />
            <StatCard title="Day 30 Retention" value={(advanced?.retention?.day30 ?? 0) / 100} format="percentage" subtitle="Return within a month" />
          </div>
        </div>
      )}

      {/* Churn Rate Trend */}
      <div className="mb-8">
        <ChartCard title="Churn Rate Trend" subtitle={`Rolling churn rate — last ${days} days`}>
          {churnTrendData.length > 0 ? (
            <LineChart
              data={churnTrendData}
              xKey="date"
              lines={[{ key: 'rate', color: '#10b981', name: 'Churn Rate %' }]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No churn trend data available yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* At-Risk Users Table */}
      <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg mb-8">
        <div className="mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">At-Risk Users</h3>
          <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">
            Inactive 7+ days or trials about to expire — sorted by lowest health score
          </p>
        </div>
        <div className="h-[300px]">
          {atRiskTableData.length > 0 ? (
            <DataTable
              data={atRiskTableData}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'type', header: 'Type' },
                { key: 'health', header: 'Health' },
                { key: 'lastActive', header: 'Last Active' },
                { key: 'platform', header: 'Platform' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No at-risk users identified
            </div>
          )}
        </div>
      </div>

      {/* Most Engaged Users Table */}
      {engagedTableData.length > 0 && (
        <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg mb-8">
          <div className="mb-6 border-b border-white/5 pb-4">
            <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">Most Engaged Users</h3>
            <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">
              Active paying subscribers with strong health scores
            </p>
          </div>
          <div className="h-[300px]">
            <DataTable
              data={engagedTableData}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'health', header: 'Health' },
                { key: 'searches', header: 'Searches' },
                { key: 'notes', header: 'Notes' },
                { key: 'lastActive', header: 'Last Active' },
                { key: 'platform', header: 'Platform' },
              ]}
            />
          </div>
        </div>
      )}

      {/* Churned Users Table (searchable) */}
      <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg mb-8">
        <div className="mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">Churned Users</h3>
          <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">
            Users who have cancelled or expired
          </p>
          <div className="mt-3">
            <input
              type="text"
              placeholder="Search by email or UID..."
              value={churnSearch}
              onChange={(e) => setChurnSearch(e.target.value)}
              className="w-full max-w-sm px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 text-foreground text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
        </div>
        <div className="h-[300px]">
          {churnedTableData.length > 0 ? (
            <DataTable
              data={churnedTableData}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'churnDate', header: 'Churn Date' },
                { key: 'tenure', header: 'Tenure' },
                { key: 'searches', header: 'Searches' },
                { key: 'notes', header: 'Notes' },
                { key: 'platform', header: 'Platform' },
                { key: 'emailsReceived', header: 'Emails Rx' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              {churnSearch ? 'No matching churned users' : 'No churned users in this period'}
            </div>
          )}
        </div>
      </div>

      {/* Winback Effectiveness */}
      <div className="mb-8">
        <ChartCard title="Winback Effectiveness" subtitle="Recovery rate by email campaign type">
          {winbackData.length > 0 ? (
            <BarChart
              data={winbackData}
              xKey="type"
              yKey="rate"
              color="#10b981"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No winback data available yet
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
