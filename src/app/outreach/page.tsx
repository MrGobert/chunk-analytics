'use client';

import { useEffect, useRef, useMemo } from 'react';
import { getDaysFromRange } from '@/lib/utils';
import Link from 'next/link';
import gsap from 'gsap';
import { Mail, Radio, Send, FileEdit, Eye, Bell, CheckCircle, BarChart3, Megaphone } from 'lucide-react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { PushMetrics } from '@/types/mixpanel';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmailTypeStats {
  sent: number;
  converted: number;
  conversionRate: number;
  avgDaysToConvert: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  openRate: number;
  clickRate: number;
}

interface DailyEmailData {
  date: string;
  sent: number;
  converted: number;
  by_type: Record<string, number>;
}

interface EmailStats {
  period_days: number;
  generated_at: string;
  by_email_type: Record<string, EmailTypeStats>;
  by_day: DailyEmailData[];
  totals: {
    sent: number;
    converted: number;
    overallConversionRate: number;
  };
  lastUpdated: string;
  note?: string;
}

interface Broadcast {
  id: string;
  name?: string;
  subject?: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

interface BroadcastData {
  broadcasts: Broadcast[];
  totals: { sent: number; draft: number; queued: number };
  lastUpdated: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EMAIL_TYPE_LABELS: Record<string, string> = {
  winback_7day: '7-Day Win-back',
  winback_30day: '30-Day Win-back',
  trial_ending: 'Trial Ending',
  billing_issue: 'Billing Issue',
  subscription_expired: 'Subscription Expired',
  trial_started: 'Trial Started',
  reengagement_14day: '14-Day Re-engagement',
  signup_no_trial_nudge: 'Signup Nudge',
  feature_announcement: 'Feature Announcement',
  renewal_reminder: 'Renewal Reminder',
  monthly_recap: 'Monthly Recap',
  day1_help_center: 'Day 1 Help Center',
  day3_artifacts: 'Day 3 Artifacts',
  day7_researcher_stories: 'Day 7 Stories',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const days = getDaysFromRange(dateRange);

  // Email stats
  const { data: emailStats, isLoading: emailLoading, isRefreshing: emailRefreshing, error: emailError, lastUpdated: emailLastUpdated } =
    useAnalytics<EmailStats>('/api/metrics/emails', { days });

  // Broadcasts
  const { data: broadcastData, isLoading: broadcastLoading } =
    useAnalytics<BroadcastData>('/api/metrics/broadcasts', { days });

  // Push metrics
  const { data: pushMetrics, isLoading: pushLoading, isRefreshing: pushRefreshing, lastUpdated: pushLastUpdated } =
    useAnalytics<PushMetrics>('/api/metrics/push', { range: dateRange, platform: 'all', userType: 'all' });

  const isLoading = emailLoading || pushLoading;
  const isRefreshing = emailRefreshing || pushRefreshing;
  const lastUpdated = emailLastUpdated || pushLastUpdated;

  // ── Derived email data (all hooks before conditional returns) ─────────

  const byEmailType = emailStats?.by_email_type ?? {};

  const byTypeData = useMemo(() =>
    Object.entries(byEmailType).map(([type, data]) => {
      const sent = data?.sent ?? 0;
      const delivered = data?.delivered ?? 0;
      const opened = data?.opened ?? 0;
      const clicked = data?.clicked ?? 0;

      return {
        name: EMAIL_TYPE_LABELS[type] || type,
        type,
        sent,
        converted: data?.converted ?? 0,
        conversionRate: data?.conversionRate ?? 0,
        delivered,
        opened,
        clicked,
        bounced: data?.bounced ?? 0,
        openRate: delivered > 0 ? Math.round((opened / delivered) * 1000) / 10 : 0,
        clickRate: delivered > 0 ? Math.round((clicked / delivered) * 1000) / 10 : 0,
      };
    }),
  [byEmailType]);

  const dailyChartData = useMemo(() =>
    (emailStats?.by_day ?? []).map((day) => ({
      date: new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sent: day.sent,
    })),
  [emailStats?.by_day]);

  const broadcastTableData = useMemo(() =>
    (broadcastData?.broadcasts ?? []).map((b) => ({
      name: b.name || b.id.slice(0, 8) + '...',
      subject: b.subject || '--',
      status: b.status,
      date: b.sent_at
        ? new Date(b.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '--',
    })),
  [broadcastData?.broadcasts]);

  const pushDestinationData = useMemo(() =>
    (pushMetrics?.destinations ?? []).slice(0, 10).map((d) => ({
      destination: d.destination || 'Unknown',
      count: d.count,
    })),
  [pushMetrics?.destinations]);

  // ── GSAP animation ────────────────────────────────────────────────────

  useEffect(() => {
    if (hasAnimated.current || isLoading) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo('.card-animate',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading]);

  // ── Conditional returns ───────────────────────────────────────────────

  if (isLoading) {
    return <SkeletonPage statCards={4} chartCards={3} />;
  }

  if (emailError) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 mb-4">{emailError}</div>
        <p className="text-zinc-500 text-sm">
          Make sure CEREBRAL_AUTH_TOKEN is configured in your environment.
        </p>
      </div>
    );
  }

  const totals = emailStats?.totals ?? { sent: 0, converted: 0, overallConversionRate: 0 };

  const tableData = byTypeData.map((item) => ({
    campaign: item.name,
    sent: item.sent,
    delivered: item.delivered,
    opened: item.opened,
    clicked: item.clicked,
    converted: item.converted,
    convRate: `${item.conversionRate}%`,
    openRate: `${item.openRate}%`,
    clickRate: `${item.clickRate}%`,
  }));

  return (
    <div ref={containerRef}>
      <PageHeader
        title="Outreach"
        subtitle="Email campaigns, broadcasts, and push notifications"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* ── Email Section Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">Email Campaigns</h2>
        </div>
        <Link
          href="/emails/templates"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-accent border border-white/5 hover:border-accent/30 transition-all duration-200"
        >
          <Eye className="w-4 h-4" />
          View Templates
        </Link>
      </div>

      {/* ── Email Stat Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Emails Sent"
          value={totals.sent}
          icon={<Send className="w-5 h-5" />}
        />
        <StatCard
          title="Conversions"
          value={totals.converted}
          icon={<CheckCircle className="w-5 h-5" />}
        />
        <StatCard
          title="Conversion Rate"
          value={(totals.overallConversionRate ?? 0) / 100}
          format="percentage"
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <StatCard
          title="Campaign Types"
          value={Object.keys(byEmailType).length}
          icon={<Megaphone className="w-5 h-5" />}
        />
      </div>

      {/* ── Email Volume Over Time ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Email Volume Over Time" subtitle="Daily sends across all campaigns">
          {dailyChartData.length > 0 ? (
            <AreaChart data={dailyChartData} xKey="date" yKey="sent" color="#E63B2E" />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No time-series data available
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── Campaign Performance Table ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Campaign Performance" subtitle="Detailed metrics by email type">
          {tableData.length > 0 ? (
            <DataTable
              data={tableData}
              columns={[
                { key: 'campaign', header: 'Campaign' },
                { key: 'sent', header: 'Sent' },
                { key: 'delivered', header: 'Delivered' },
                { key: 'opened', header: 'Opened' },
                { key: 'clicked', header: 'Clicked' },
                { key: 'converted', header: 'Converted' },
                { key: 'convRate', header: 'Conv Rate' },
                { key: 'openRate', header: 'Open Rate' },
                { key: 'clickRate', header: 'Click Rate' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No campaign data available
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── Broadcasts ───────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Radio className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">Broadcasts</h2>
          {broadcastData?.totals && (
            <div className="flex gap-2 ml-auto">
              {broadcastData.totals.sent > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                  <Send className="w-3 h-3" />
                  {broadcastData.totals.sent} sent
                </span>
              )}
              {broadcastData.totals.draft > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-500/10 text-zinc-400 text-xs font-medium">
                  <FileEdit className="w-3 h-3" />
                  {broadcastData.totals.draft} draft
                </span>
              )}
            </div>
          )}
        </div>

        {broadcastLoading ? (
          <div className="p-8 bg-primary rounded-lg border border-zinc-800 text-center text-zinc-500">
            Loading broadcasts...
          </div>
        ) : broadcastTableData.length > 0 ? (
          <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg">
            <DataTable
              data={broadcastTableData}
              columns={[
                { key: 'name', header: 'Name' },
                { key: 'subject', header: 'Subject' },
                {
                  key: 'status',
                  header: 'Status',
                  render: (val) => {
                    const s = String(val);
                    return (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        s === 'sent' ? 'bg-emerald-500/10 text-emerald-400' :
                        s === 'queued' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-zinc-500/10 text-zinc-400'
                      }`}>
                        {s}
                      </span>
                    );
                  },
                },
                { key: 'date', header: 'Date' },
              ]}
            />
          </div>
        ) : (
          <div className="p-6 bg-primary rounded-lg border border-zinc-800 text-center text-zinc-500 text-sm">
            No broadcasts found. Create one in the{' '}
            <a
              href="https://resend.com/broadcasts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Resend dashboard
            </a>
            .
          </div>
        )}
      </div>

      {/* ── Push Notifications Section Divider ───────────────────────────── */}
      <div className="flex items-center gap-4 my-10">
        <div className="flex-1 h-px bg-white/5" />
        <div className="flex items-center gap-2 text-zinc-400">
          <Bell className="w-5 h-5" />
          <span className="text-lg font-semibold text-foreground">Push Notifications</span>
        </div>
        <div className="flex-1 h-px bg-white/5" />
      </div>

      {/* ── Push Stat Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Opt-in Rate"
          value={pushMetrics?.optInRate ?? 0}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Notifications Opened"
          value={pushMetrics?.notificationsOpened ?? 0}
          trend={pushMetrics?.openedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard
          title="Permission Requested"
          value={pushMetrics?.permissionRequested ?? 0}
          trend={pushMetrics?.requestedTrend}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          }
        />
      </div>

      {/* ── Push Destinations ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Push Destinations" subtitle="Where users navigate from push notifications">
          {pushDestinationData.length > 0 ? (
            <BarChart data={pushDestinationData} xKey="destination" yKey="count" horizontal />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No push destination data available
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
