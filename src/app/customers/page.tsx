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
import { chart } from '@/lib/chartTheme';
import type { ChurnIntelligence, CustomerHealth } from '@/types/mixpanel';
import { HeartPulse, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';

function healthDot(score: number) {
  const cls = score >= 60 ? 'bg-sage' : score >= 30 ? 'bg-butter' : 'bg-ember';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-2 align-middle`} />;
}

export default function CustomersPage() {
  const { dateRange, setDateRange } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const [churnSearch, setChurnSearch] = useState('');

  const days = getDaysFromRange(dateRange, '90');

  const { data: churn, isLoading, isRefreshing, error, lastUpdated } =
    useAnalytics<ChurnIntelligence>('/api/rc/churn-intelligence', { days });
  const { data: health } =
    useAnalytics<CustomerHealth>('/api/rc/customer-health', {});

  const churnTrendData = useMemo(() =>
    (churn?.churnRateTrend || []).map((d) => ({ date: d.date, rate: d.rate })),
    [churn?.churnRateTrend]
  );

  const atRiskTableData = useMemo(() => {
    const users = [...(churn?.atRiskUsers || [])];
    users.sort((a, b) => (a.healthScore ?? -1) - (b.healthScore ?? -1));
    return users.map((u) => ({
      uid: u.uid,
      email: u.email || u.uid,
      type: u.subscriptionType === 'trial' ? `Trial${u.trialEndsIn != null ? ` (${u.trialEndsIn}d left)` : ''}` : 'Active',
      health: u.healthScore,
      lastActive: u.daysSinceActive != null ? `${u.daysSinceActive}d ago` : 'Never',
      platform: u.platform,
    }));
  }, [churn?.atRiskUsers]);

  const engagedTableData = useMemo(() => {
    const users = [...(churn?.topEngagedUsers || [])];
    users.sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));
    return users.map((u) => ({
      uid: u.uid,
      email: u.email || u.uid,
      health: u.healthScore,
      searches: u.usage?.searches ?? 0,
      notes: u.usage?.notes ?? 0,
      lastActive: u.daysSinceActive != null ? `${u.daysSinceActive}d ago` : 'N/A',
      platform: u.platform,
    }));
  }, [churn?.topEngagedUsers]);

  const churnedTableData = useMemo(() => {
    let users = churn?.churnedUsers || [];
    if (churnSearch) {
      const q = churnSearch.toLowerCase();
      users = users.filter((u) => (u.email || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q));
    }
    return users.map((u) => ({
      uid: u.uid,
      email: u.email || u.uid,
      churnDate: u.churnDate,
      tenure: `${u.tenure}d`,
      searches: u.usage?.searches ?? 0,
      notes: u.usage?.notes ?? 0,
      platform: u.platform,
      emailsReceived: (u.emailsReceived || []).length,
    }));
  }, [churn?.churnedUsers, churnSearch]);

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
        const mm = gsap.matchMedia();
        mm.add('(prefers-reduced-motion: no-preference)', () => {
          gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
        });
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
        <div className="text-ember-deep mb-4">{error}</div>
        <p className="text-ink-faint text-sm font-mono">Make sure CEREBRAL_AUTH_TOKEN is configured.</p>
      </div>
    );
  }

  if (!churn) {
    return <div className="empty-state py-20">Failed to load customer data. Please try again.</div>;
  }

  const dataUnavailable = churn.dataUnavailable === true;
  const dist = health?.distribution;

  const uidLink = (row: { uid?: string }) => (row.uid ? `/customers/${row.uid}` : null);
  const healthCell = (v: unknown) => (
    <span className="font-mono tabular-nums">{healthDot(Number(v))}{String(v)}</span>
  );

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Customers"
        subtitle="Health scores, at-risk accounts, and churn — click any row to drill in"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {dataUnavailable && churn.note && (
        <div className="mb-6 p-4 bg-butter-tint border border-butter rounded-card flex items-center gap-3 text-ink">
          <AlertTriangle className="w-6 h-6 shrink-0 text-[#C8922A]" />
          <div>
            <p className="font-semibold text-sm">Data Temporarily Unavailable</p>
            <p className="text-ink-soft text-xs mt-1">{churn.note}</p>
          </div>
        </div>
      )}

      {/* Health distribution + churn KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card-animate"><StatCard title="Healthy" value={dist?.healthy ?? 0} subtitle="Health score ≥ 60" icon={<ShieldCheck className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="At Risk" value={dist?.atRisk ?? (churn.atRiskCount || 0)} subtitle={churn.trialAtRiskCount ? `${churn.trialAtRiskCount} trials expiring` : 'Health 30–59'} icon={<AlertTriangle className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Churning" value={dist?.churning ?? 0} subtitle="Health score < 30" icon={<HeartPulse className="w-5 h-5" />} /></div>
        <div className="card-animate"><StatCard title="Monthly Churn Rate" value={dataUnavailable ? '—' : churn.churnRate / 100} format={dataUnavailable ? 'text' : 'percentage'} invertTrend icon={<Activity className="w-5 h-5" />} /></div>
      </div>

      {/* Churn trend */}
      <div className="card-animate mb-8">
        <ChartCard title="Churn Rate Trend" subtitle={`Rolling churn rate — last ${days} days`}>
          {churnTrendData.length > 0 ? (
            <LineChart data={churnTrendData} xKey="date" lines={[{ key: 'rate', color: chart.primary, name: 'Churn Rate %' }]} />
          ) : (
            <div className="empty-state h-full">No churn trend data available yet</div>
          )}
        </ChartCard>
      </div>

      {/* At-risk table */}
      <div className="card-animate card-surface p-6 sm:p-8 mb-8">
        <div className="mb-6 border-b border-line pb-4">
          <h3 className="font-display text-xl sm:text-2xl text-ink">At-Risk Customers</h3>
          <p className="text-sm font-mono text-ink-faint mt-2">Inactive 7+ days or trials about to expire — lowest health first</p>
        </div>
        <div className="h-[320px]">
          {atRiskTableData.length > 0 ? (
            <DataTable
              data={atRiskTableData}
              getRowHref={uidLink}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'type', header: 'Type' },
                { key: 'health', header: 'Health', numeric: true, render: healthCell },
                { key: 'lastActive', header: 'Last Active' },
                { key: 'platform', header: 'Platform' },
              ]}
            />
          ) : (
            <div className="empty-state h-full">No at-risk users identified</div>
          )}
        </div>
      </div>

      {/* Most engaged table */}
      {engagedTableData.length > 0 && (
        <div className="card-animate card-surface p-6 sm:p-8 mb-8">
          <div className="mb-6 border-b border-line pb-4">
            <h3 className="font-display text-xl sm:text-2xl text-ink">Most Engaged Customers</h3>
            <p className="text-sm font-mono text-ink-faint mt-2">Active subscribers with strong health scores</p>
          </div>
          <div className="h-[320px]">
            <DataTable
              data={engagedTableData}
              getRowHref={uidLink}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'health', header: 'Health', numeric: true, render: healthCell },
                { key: 'searches', header: 'Searches', numeric: true },
                { key: 'notes', header: 'Notes', numeric: true },
                { key: 'lastActive', header: 'Last Active' },
                { key: 'platform', header: 'Platform' },
              ]}
            />
          </div>
        </div>
      )}

      {/* Churned table (searchable) */}
      <div className="card-animate card-surface p-6 sm:p-8 mb-8">
        <div className="mb-6 border-b border-line pb-4">
          <h3 className="font-display text-xl sm:text-2xl text-ink">Churned Customers</h3>
          <p className="text-sm font-mono text-ink-faint mt-2">Cancelled or expired in the last 90 days</p>
          <div className="mt-3">
            <input
              type="text"
              placeholder="Search by email or UID…"
              value={churnSearch}
              onChange={(e) => setChurnSearch(e.target.value)}
              className="input-paper w-full max-w-sm px-4 py-2 text-sm font-mono placeholder:text-ink-faint outline-none"
            />
          </div>
        </div>
        <div className="h-[320px]">
          {churnedTableData.length > 0 ? (
            <DataTable
              data={churnedTableData}
              getRowHref={uidLink}
              columns={[
                { key: 'email', header: 'User' },
                { key: 'churnDate', header: 'Churn Date' },
                { key: 'tenure', header: 'Tenure', numeric: true },
                { key: 'searches', header: 'Searches', numeric: true },
                { key: 'notes', header: 'Notes', numeric: true },
                { key: 'platform', header: 'Platform' },
                { key: 'emailsReceived', header: 'Emails Rx', numeric: true },
              ]}
            />
          ) : (
            <div className="empty-state h-full">{churnSearch ? 'No matching churned users' : 'No churned users in this period'}</div>
          )}
        </div>
      </div>

      {/* Winback */}
      <div className="card-animate">
        <ChartCard title="Winback Effectiveness" subtitle="Recovery rate by email campaign type">
          {winbackData.length > 0 ? (
            <BarChart data={winbackData} xKey="type" yKey="rate" color={chart.sage} />
          ) : (
            <div className="empty-state h-full">No winback data available yet</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
