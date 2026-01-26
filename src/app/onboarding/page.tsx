'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getDateRange, getDaysInRange } from '@/lib/utils';

interface OnboardingMetrics {
  funnel: { name: string; count: number; percentage: number; dropoff: number }[];
  onboardingOverTime: { date: string; count: number }[];
  signupsOverTime: { date: string; count: number }[];
  firstOpenToSignup: { day: string; count: number }[];
  totalFirstOpens: number;
  totalSignups: number;
  conversionRate: number;
}

export default function OnboardingPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [metrics, setMetrics] = useState<OnboardingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/events?range=${dateRange}`);
        const data = await res.json();

        const events = data.events || [];
        const range = getDateRange(dateRange);
        const days = getDaysInRange(range.from, range.to);

        // First opens
        const firstOpens = events.filter((e: { event: string }) => e.event === '$ae_first_open');
        const totalFirstOpens = firstOpens.length;

        // Onboarding events
        const onboardingEvents = events.filter((e: { event: string }) => e.event === 'Onboarding');

        // Signups
        const signups = events.filter((e: { event: string }) => e.event === 'SignUp');
        const totalSignups = signups.length;

        // Conversion rate
        const conversionRate = totalFirstOpens > 0 ? totalSignups / totalFirstOpens : 0;

        // Funnel
        const funnel = [
          {
            name: 'First Open',
            count: totalFirstOpens,
            percentage: 100,
            dropoff: 0,
          },
          {
            name: 'Started Onboarding',
            count: onboardingEvents.length,
            percentage: totalFirstOpens > 0 ? (onboardingEvents.length / totalFirstOpens) * 100 : 0,
            dropoff:
              totalFirstOpens > 0
                ? ((totalFirstOpens - onboardingEvents.length) / totalFirstOpens) * 100
                : 0,
          },
          {
            name: 'Signed Up',
            count: totalSignups,
            percentage: totalFirstOpens > 0 ? (totalSignups / totalFirstOpens) * 100 : 0,
            dropoff:
              onboardingEvents.length > 0
                ? ((onboardingEvents.length - totalSignups) / onboardingEvents.length) * 100
                : 0,
          },
        ];

        // Over time data
        const onboardingOverTime = days.map((date) => ({
          date,
          count: onboardingEvents.filter((e: { properties: { time: number } }) => {
            const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
            return eventDate === date;
          }).length,
        }));

        const signupsOverTime = days.map((date) => ({
          date,
          count: signups.filter((e: { properties: { time: number } }) => {
            const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
            return eventDate === date;
          }).length,
        }));

        // First open to signup (same day vs later)
        const firstOpenUsers = new Map<string, number>();
        for (const event of firstOpens) {
          firstOpenUsers.set(event.properties.distinct_id, event.properties.time);
        }

        const timeDiffs: number[] = [];
        for (const event of signups) {
          const firstOpenTime = firstOpenUsers.get(event.properties.distinct_id);
          if (firstOpenTime) {
            const diffDays = Math.floor((event.properties.time - firstOpenTime) / 86400);
            timeDiffs.push(diffDays);
          }
        }

        const firstOpenToSignup = [
          { day: 'Same day', count: timeDiffs.filter((d) => d === 0).length },
          { day: 'Day 1', count: timeDiffs.filter((d) => d === 1).length },
          { day: 'Day 2-3', count: timeDiffs.filter((d) => d >= 2 && d <= 3).length },
          { day: 'Day 4-7', count: timeDiffs.filter((d) => d >= 4 && d <= 7).length },
          { day: 'Day 8+', count: timeDiffs.filter((d) => d > 7).length },
        ];

        setMetrics({
          funnel,
          onboardingOverTime,
          signupsOverTime,
          firstOpenToSignup,
          totalFirstOpens,
          totalSignups,
          conversionRate,
        });
        setLastUpdated(data.lastUpdated);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-400 py-20">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle="User acquisition and onboarding funnel"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        lastUpdated={lastUpdated}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="First Opens" value={metrics.totalFirstOpens} />
        <StatCard title="Sign Ups" value={metrics.totalSignups} />
        <StatCard title="Conversion Rate" value={metrics.conversionRate} format="percentage" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard
          title="Onboarding Funnel"
          subtitle="From first open to signup"
          className="h-auto"
        >
          <FunnelChart data={metrics.funnel} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Onboarding Events Over Time" subtitle="Daily onboarding activity">
          <AreaChart
            data={metrics.onboardingOverTime}
            xKey="date"
            yKey="count"
            color="#8b5cf6"
          />
        </ChartCard>
        <ChartCard title="Sign Ups Over Time" subtitle="Daily new user registrations">
          <AreaChart
            data={metrics.signupsOverTime}
            xKey="date"
            yKey="count"
            color="#22c55e"
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Time to Signup" subtitle="Days from first open to signup">
          <BarChart data={metrics.firstOpenToSignup} xKey="day" yKey="count" color="#6366f1" />
        </ChartCard>
      </div>
    </div>
  );
}
