'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

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

interface EmailStats {
  period_days: number;
  generated_at: string;
  by_email_type: Record<string, EmailTypeStats>;
  totals: {
    sent: number;
    converted: number;
    overallConversionRate: number;
  };
  lastUpdated: string;
  note?: string;
}

// Friendly names for email types
const EMAIL_TYPE_LABELS: Record<string, string> = {
  winback_7day: '7-Day Win-back',
  winback_30day: '30-Day Win-back',
  trial_ending: 'Trial Ending',
  billing_issue: 'Billing Issue',
  subscription_expired: 'Subscription Expired',
  trial_started: 'Trial Started',
  reengagement_14day: '14-Day Re-engagement',
  signup_no_trial_nudge: 'Signup No-Trial Nudge',
  feature_announcement: 'Feature Announcement',
  renewal_reminder: 'Renewal Reminder',
  monthly_recap: 'Monthly Recap',
  day1_superpowers: 'Day 1: Superpowers',
  day3_collections: 'Day 3: Collections',
  day7_researcher_stories: 'Day 7: Researcher Stories',
};

export default function EmailCampaignsPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      setError(null);
      
      // Convert dateRange to days
      const daysMap: Record<string, number> = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
      };
      const days = daysMap[dateRange] || 30;

      try {
        const res = await fetch(`/api/metrics/emails?days=${days}`);
        const data = await res.json();
        
        if (data.error) {
          setError(data.error);
          return;
        }
        
        setStats(data);
        setLastUpdated(data.lastUpdated);
      } catch (err) {
        console.error('Failed to fetch email stats:', err);
        setError('Failed to load email campaign data');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-red-400 mb-4">{error}</div>
        <p className="text-zinc-500 text-sm">
          Make sure CEREBRAL_AUTH_TOKEN is configured in your environment.
        </p>
      </div>
    );
  }

  // Safely extract stats with defaults
  const totals = stats?.totals ?? { sent: 0, converted: 0, overallConversionRate: 0 };
  const byEmailType = stats?.by_email_type ?? {};
  
  // Transform data for charts with null-safe handling
  const byTypeData = Object.entries(byEmailType).map(([type, data]) => {
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
      avgDaysToConvert: data?.avgDaysToConvert ?? 0,
      delivered,
      opened,
      clicked,
      bounced: data?.bounced ?? 0,
      openRate: delivered > 0 ? Math.round((opened / delivered) * 100 * 10) / 10 : 0,
      clickRate: delivered > 0 ? Math.round((clicked / delivered) * 100 * 10) / 10 : 0,
    };
  });

  const conversionData = byTypeData.map((item) => ({
    name: item.name,
    value: item.converted,
  }));

  const sentData = byTypeData.map((item) => ({
    type: item.name,
    count: item.sent,
  }));

  const conversionRateData = byTypeData.map((item) => ({
    type: item.name,
    rate: item.conversionRate,
  }));
  
  // Calculate overall open and click rates
  const totalDelivered = byTypeData.reduce((sum, item) => sum + item.delivered, 0);
  const totalOpened = byTypeData.reduce((sum, item) => sum + item.opened, 0);
  const totalClicked = byTypeData.reduce((sum, item) => sum + item.clicked, 0);
  const overallOpenRate = totalDelivered > 0 ? (totalOpened / totalDelivered) : 0;
  const overallClickRate = totalDelivered > 0 ? (totalClicked / totalDelivered) : 0;

  const tableData = byTypeData.map((item) => ({
    emailType: item.name,
    sent: item.sent,
    delivered: item.delivered,
    opened: item.opened,
    clicked: item.clicked,
    converted: item.converted,
    conversionRate: `${item.conversionRate}%`,
    openRate: `${item.openRate}%`,
    clickRate: `${item.clickRate}%`,
    avgDays: item.avgDaysToConvert > 0 ? `${item.avgDaysToConvert} days` : '—',
  }));

  return (
    <div>
      <PageHeader
        title="Email Campaigns"
        subtitle="Track email sends and conversion attribution"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
      />

      {/* Warning banner if data couldn't be loaded */}
      {stats?.note && (
        <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{stats.note}</span>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6 mb-8">
        <StatCard 
          title="Emails Sent" 
          value={totals.sent ?? 0} 
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard 
          title="Conversions" 
          value={totals.converted ?? 0}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard 
          title="Conversion Rate" 
          value={(totals.overallConversionRate ?? 0) / 100}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard 
          title="Campaign Types" 
          value={Object.keys(byEmailType).length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard 
          title="Open Rate" 
          value={overallOpenRate}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        />
        <StatCard 
          title="Click Rate" 
          value={overallClickRate}
          format="percentage"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          }
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Emails Sent by Campaign" subtitle="Volume breakdown by email type">
          {sentData.length > 0 ? (
            <BarChart data={sentData} xKey="type" yKey="count" horizontal />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No data available
            </div>
          )}
        </ChartCard>
        <ChartCard title="Conversion Rate by Campaign" subtitle="Performance comparison">
          {conversionRateData.length > 0 ? (
            <BarChart 
              data={conversionRateData} 
              xKey="type" 
              yKey="rate" 
              horizontal
              color="#22c55e"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No data available
            </div>
          )}
        </ChartCard>
      </div>

      {/* Conversions Pie & Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Conversions by Campaign" subtitle="Distribution of attributed conversions">
          {conversionData.some(d => d.value > 0) ? (
            <PieChart 
              data={conversionData.filter(d => d.value > 0)} 
              colors={['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444']}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No conversions yet
            </div>
          )}
        </ChartCard>
        <ChartCard title="Campaign Performance" subtitle="Detailed metrics by email type">
          {tableData.length > 0 ? (
            <DataTable
              data={tableData}
              columns={[
                { key: 'emailType', header: 'Campaign' },
                { key: 'sent', header: 'Sent' },
                { key: 'delivered', header: 'Delivered' },
                { key: 'opened', header: 'Opened' },
                { key: 'clicked', header: 'Clicked' },
                { key: 'converted', header: 'Converted' },
                { key: 'conversionRate', header: 'Conv Rate' },
                { key: 'openRate', header: 'Open Rate' },
                { key: 'clickRate', header: 'Click Rate' },
                { key: 'avgDays', header: 'Avg Days' },
              ]}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              No campaign data
            </div>
          )}
        </ChartCard>
      </div>

      {/* Attribution Info */}
      <div className="mt-8 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-zinc-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Attribution Window</p>
            <p>
              Conversions are attributed to emails sent within 30 days of a purchase. 
              If a user receives multiple emails before converting, all are credited.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
