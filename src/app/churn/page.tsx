'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { getDaysFromRange } from '@/lib/utils';
import type { ChurnIntelligence, AdvancedMetrics } from '@/types/mixpanel';

export default function ChurnIntelligencePage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const [churnSearch, setChurnSearch] = useState('');
  const [atRiskSort, setAtRiskSort] = useState<'healthScore' | 'daysSinceActive' | 'subscriptionAge'>('healthScore');
  const [atRiskSortDir, setAtRiskSortDir] = useState<'asc' | 'desc'>('asc');
  const [engagedSort, setEngagedSort] = useState<'healthScore' | 'daysSinceActive' | 'searches'>('healthScore');
  const [engagedSortDir, setEngagedSortDir] = useState<'asc' | 'desc'>('desc');

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

  // Churn reasons data for PieChart and BarChart
  const churnReasonsData = useMemo(() => {
    const reasons = churn?.churnReasons || {};
    return Object.entries(reasons)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [churn?.churnReasons]);

  const churnReasonsBarData = useMemo(() =>
    churnReasonsData.map((d) => ({ reason: d.name, count: d.value })),
    [churnReasonsData]
  );

  // At-risk users sorted (null values sort to top = most risky)
  const sortedAtRiskUsers = useMemo(() => {
    const users = [...(churn?.atRiskUsers || [])];
    users.sort((a, b) => {
      const aVal = a[atRiskSort] ?? (atRiskSortDir === 'asc' ? -Infinity : Infinity);
      const bVal = b[atRiskSort] ?? (atRiskSortDir === 'asc' ? -Infinity : Infinity);
      return atRiskSortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return users;
  }, [churn?.atRiskUsers, atRiskSort, atRiskSortDir]);

  // At-risk table data — show "N/A" for null values, include Type column
  const atRiskTableData = useMemo(() =>
    sortedAtRiskUsers.map((u) => ({
      email: u.email || u.uid,
      type: u.subscriptionType === 'trial'
        ? `Trial${u.trialEndsIn != null ? ` (${u.trialEndsIn}d left)` : ''}`
        : 'Active',
      healthScore: u.healthScore.toString(),
      daysSinceActive: u.daysSinceActive != null ? `${u.daysSinceActive}d` : 'N/A',
      subscriptionAge: u.subscriptionAge != null ? `${u.subscriptionAge}d` : 'N/A',
      platform: u.platform,
    })),
    [sortedAtRiskUsers]
  );

  // Engaged users sorted
  const sortedEngagedUsers = useMemo(() => {
    const users = [...(churn?.topEngagedUsers || [])];
    users.sort((a, b) => {
      let aVal: number, bVal: number;
      if (engagedSort === 'searches') {
        aVal = a.usage?.searches ?? 0;
        bVal = b.usage?.searches ?? 0;
      } else {
        aVal = a[engagedSort] ?? 0;
        bVal = b[engagedSort] ?? 0;
      }
      return engagedSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return users;
  }, [churn?.topEngagedUsers, engagedSort, engagedSortDir]);

  // Engaged users table data
  const engagedTableData = useMemo(() =>
    sortedEngagedUsers.map((u) => ({
      email: u.email || u.uid,
      healthScore: u.healthScore.toString(),
      searches: (u.usage?.searches ?? 0).toString(),
      notes: (u.usage?.notes ?? 0).toString(),
      collections: (u.usage?.collections ?? 0).toString(),
      subscriptionAge: u.subscriptionAge != null ? `${u.subscriptionAge}d` : 'N/A',
      platform: u.platform,
    })),
    [sortedEngagedUsers]
  );

  // Churned users filtered by search
  const filteredChurnedUsers = useMemo(() => {
    const users = churn?.churnedUsers || [];
    if (!churnSearch) return users;
    const q = churnSearch.toLowerCase();
    return users.filter((u) =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.uid || '').toLowerCase().includes(q)
    );
  }, [churn?.churnedUsers, churnSearch]);

  // Churned users table data — includes reason column
  const churnedTableData = useMemo(() =>
    filteredChurnedUsers.map((u) => ({
      email: u.email || u.uid,
      churnDate: u.churnDate,
      tenure: `${u.tenure}d`,
      reason: u.reason || 'Unknown',
      searches: u.usage?.searches?.toString() || '0',
      notes: u.usage?.notes?.toString() || '0',
      platform: u.platform,
      emailsReceived: (u.emailsReceived || []).length.toString(),
    })),
    [filteredChurnedUsers]
  );

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
    return <SkeletonPage statCards={6} statCardCols="grid-cols-1 md:grid-cols-3 lg:grid-cols-6" chartCards={3} />;
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

  const makeSortHandler = <T extends string>(
    currentSort: T,
    setSort: (col: T) => void,
    setSortDir: (fn: (d: 'asc' | 'desc') => 'asc' | 'desc') => void,
    defaultDir: 'asc' | 'desc',
  ) => (col: T) => {
    if (currentSort === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(col);
      setSortDir(() => defaultDir);
    }
  };

  const handleAtRiskSortClick = makeSortHandler(atRiskSort, setAtRiskSort, setAtRiskSortDir, 'asc');
  const handleEngagedSortClick = makeSortHandler(engagedSort, setEngagedSort, setEngagedSortDir, 'desc');

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

      {/* Warning banner (non-unavailable notes) */}
      {!dataUnavailable && churn.note && (
        <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{churn.note}</span>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-8">
        <StatCard
          title="Monthly Churn Rate"
          value={dataUnavailable ? '—' : churn.churnRate / 100}
          format={dataUnavailable ? 'text' : 'percentage'}
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
            </svg>
          }
        />
        <StatCard
          title="At-Risk Users"
          value={dataUnavailable ? '—' : (churn.atRiskCount || (churn.atRiskUsers || []).length)}
          format={dataUnavailable ? 'text' : undefined}
          icon={
            <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <StatCard
          title="Trials Expiring Soon"
          value={dataUnavailable ? '—' : (churn.trialAtRiskCount ?? 0)}
          format={dataUnavailable ? 'text' : undefined}
          icon={
            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Engaged Users"
          value={dataUnavailable ? '—' : (churn.engagedCount ?? 0)}
          format={dataUnavailable ? 'text' : undefined}
          icon={
            <svg className="w-5 h-5 text-[#34D399]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Winback Rate"
          value={dataUnavailable ? '—' : churn.winbackRate / 100}
          format={dataUnavailable ? 'text' : 'percentage'}
          icon={
            <svg className="w-5 h-5 text-[#34D399]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />
        <StatCard
          title="Avg Tenure Before Churn"
          value={dataUnavailable ? '—' : `${churn.avgTenureBeforeChurn}d`}
          format="text"
          icon={
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
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
      <div className="grid grid-cols-1 gap-6 mb-8">
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

      {/* Churn Reasons Breakdown */}
      {churnReasonsData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <ChartCard title="Churn Reasons" subtitle="Distribution of churn causes">
            <PieChart
              data={churnReasonsData}
              innerRadius={50}
              outerRadius={90}
            />
          </ChartCard>
          <ChartCard title="Churn Reasons by Count" subtitle="Sorted by frequency">
            <BarChart
              data={churnReasonsBarData}
              xKey="reason"
              yKey="count"
              color="#8b5cf6"
            />
          </ChartCard>
        </div>
      )}

      {/* At-Risk Users Table */}
      <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg mb-8">
        <div className="mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">At-Risk Users</h3>
          <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">
            Users with declining health scores — click column headers to sort
          </p>
          <div className="flex gap-2 mt-3">
            {(['healthScore', 'daysSinceActive', 'subscriptionAge'] as const).map((col) => (
              <button
                key={col}
                onClick={() => handleAtRiskSortClick(col)}
                className={`text-xs font-mono px-3 py-1 rounded-full border transition-colors ${atRiskSort === col
                    ? 'bg-accent/10 border-accent/20 text-accent'
                    : 'bg-white/5 border-transparent text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
              >
                {col === 'healthScore' ? 'Health' : col === 'daysSinceActive' ? 'Inactive' : 'Tenure'}
                {atRiskSort === col && (atRiskSortDir === 'asc' ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[300px]">
          {atRiskTableData.length > 0 ? (
            <DataTable
              data={atRiskTableData}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'type', header: 'Type' },
                { key: 'healthScore', header: 'Health' },
                { key: 'daysSinceActive', header: 'Inactive' },
                { key: 'subscriptionAge', header: 'Tenure' },
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
      <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg mb-8">
        <div className="mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">Most Engaged Users</h3>
          <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">
            Active users with strong health scores — last 7 days
          </p>
          <div className="flex gap-2 mt-3">
            {(['healthScore', 'daysSinceActive', 'searches'] as const).map((col) => (
              <button
                key={col}
                onClick={() => handleEngagedSortClick(col)}
                className={`text-xs font-mono px-3 py-1 rounded-full border transition-colors ${engagedSort === col
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-white/5 border-transparent text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
              >
                {col === 'healthScore' ? 'Health' : col === 'daysSinceActive' ? 'Last Active' : 'Searches'}
                {engagedSort === col && (engagedSortDir === 'asc' ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[300px]">
          {engagedTableData.length > 0 ? (
            <DataTable
              data={engagedTableData}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'healthScore', header: 'Health' },
                { key: 'searches', header: 'Searches' },
                { key: 'notes', header: 'Notes' },
                { key: 'collections', header: 'Collections' },
                { key: 'subscriptionAge', header: 'Tenure' },
                { key: 'platform', header: 'Platform' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No engaged users in this period
            </div>
          )}
        </div>
      </div>

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
                { key: 'reason', header: 'Reason' },
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
      <div className="grid grid-cols-1 gap-6">
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
