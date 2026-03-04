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

interface AtRiskUser {
  uid: string;
  email: string;
  lastActive: string;
  daysSinceActive: number;
  healthScore: number;
  subscriptionAge: number;
  platform: string;
}

interface ChurnedUser {
  uid: string;
  email: string;
  churnDate: string;
  tenure: number;
  emailsReceived: string[];
  emailsOpened: string[];
  platform: string;
  usage: { searches: number; notes: number };
}

interface WinbackStats {
  sent: number;
  recovered: number;
  rate: number;
}

interface ChurnIntelligence {
  churnRate: number;
  churnRateTrend: { date: string; rate: number }[];
  atRiskUsers: AtRiskUser[];
  churnedUsers: ChurnedUser[];
  winbackEffectiveness: Record<string, WinbackStats>;
  churnReasons: Record<string, number>;
  avgTenureBeforeChurn: number;
  atRiskCount: number;
  winbackRate: number;
  lastUpdated: string;
  note?: string;
  dataUnavailable?: boolean;
}

export default function ChurnIntelligencePage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const [churnSearch, setChurnSearch] = useState('');
  const [atRiskSort, setAtRiskSort] = useState<'healthScore' | 'daysSinceActive' | 'subscriptionAge'>('healthScore');
  const [atRiskSortDir, setAtRiskSortDir] = useState<'asc' | 'desc'>('asc');

  const daysMap: Record<string, string> = { '7d': '7', '30d': '30', '90d': '90' };
  const days = daysMap[dateRange] || '90';

  const { data: churn, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<ChurnIntelligence>('/api/rc/churn-intelligence', { days });

  // Churn rate trend for line chart
  const churnTrendData = useMemo(() =>
    (churn?.churnRateTrend || []).map((d) => ({ date: d.date, rate: d.rate })),
    [churn?.churnRateTrend]
  );

  // At-risk users sorted
  const sortedAtRiskUsers = useMemo(() => {
    const users = [...(churn?.atRiskUsers || [])];
    users.sort((a, b) => {
      const aVal = a[atRiskSort];
      const bVal = b[atRiskSort];
      return atRiskSortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return users;
  }, [churn?.atRiskUsers, atRiskSort, atRiskSortDir]);

  // At-risk table data
  const atRiskTableData = useMemo(() =>
    sortedAtRiskUsers.map((u) => ({
      email: u.email || u.uid,
      healthScore: u.healthScore.toString(),
      daysSinceActive: `${u.daysSinceActive}d`,
      subscriptionAge: `${u.subscriptionAge}d`,
      platform: u.platform,
    })),
    [sortedAtRiskUsers]
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

  // Churned users table data
  const churnedTableData = useMemo(() =>
    filteredChurnedUsers.map((u) => ({
      email: u.email || u.uid,
      churnDate: u.churnDate,
      tenure: `${u.tenure}d`,
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
    if (!isLoading && churn) {
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

  const dataUnavailable = churn.dataUnavailable || (
    churn.churnRate === 0 &&
    churn.atRiskCount === 0 &&
    churn.winbackRate === 0 &&
    !!churn.note
  );

  const handleAtRiskSortClick = (col: 'healthScore' | 'daysSinceActive' | 'subscriptionAge') => {
    if (atRiskSort === col) {
      setAtRiskSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setAtRiskSort(col);
      setAtRiskSortDir('asc');
    }
  };

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Churn Intelligence"
        subtitle="Monitor churn, identify at-risk users, and track winback campaigns"
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

      {/* Churn Rate Trend */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Churn Rate Trend" subtitle={`Rolling churn rate — last ${days} days`}>
          {churnTrendData.length > 0 ? (
            <LineChart
              data={churnTrendData}
              xKey="date"
              lines={[{ key: 'rate', color: '#E63B2E', name: 'Churn Rate %' }]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
              No churn trend data available yet
            </div>
          )}
        </ChartCard>
      </div>

      {/* At-Risk Users Table */}
      <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-6 sm:p-8 shadow-sm mb-8">
        <div className="mb-6 border-b border-zinc-300/50 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">At-Risk Users</h3>
          <p className="text-sm font-mono text-zinc-500 mt-2 uppercase tracking-wide">
            Users with declining health scores — click column headers to sort
          </p>
          <div className="flex gap-2 mt-3">
            {(['healthScore', 'daysSinceActive', 'subscriptionAge'] as const).map((col) => (
              <button
                key={col}
                onClick={() => handleAtRiskSortClick(col)}
                className={`text-xs font-mono px-3 py-1 rounded-full transition-colors ${
                  atRiskSort === col
                    ? 'bg-accent text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
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

      {/* Churned Users Table (searchable) */}
      <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-6 sm:p-8 shadow-sm mb-8">
        <div className="mb-6 border-b border-zinc-300/50 pb-4">
          <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">Churned Users</h3>
          <p className="text-sm font-mono text-zinc-500 mt-2 uppercase tracking-wide">
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
      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Winback Effectiveness" subtitle="Recovery rate by email campaign type">
          {winbackData.length > 0 ? (
            <BarChart
              data={winbackData}
              xKey="type"
              yKey="rate"
              color="#22c55e"
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
