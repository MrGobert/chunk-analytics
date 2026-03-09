'use client';

import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import PageHeader from '@/components/layout/PageHeader';
import ChartCard from '@/components/cards/ChartCard';
import StatCard from '@/components/cards/StatCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { UserMetrics, UserBreakdown } from '@/types/mixpanel';

interface ExtendedUserMetrics extends UserMetrics {
  userBreakdown?: UserBreakdown;
}

interface OnboardingCategory {
  key: string;
  name: string;
  count: number;
  percentage: number;
}

interface OnboardingCategoriesData {
  categories: OnboardingCategory[];
  totalUsersWithCategories: number;
  totalUsers: number;
  adoptionRate: number;
}

const CATEGORY_COLORS = [
  '#8b5cf6', // purple
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#0ea5e9', // sky
  '#14b8a6', // teal
  '#22c55e', // green
  '#84cc16', // lime
  '#eab308', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#ec4899', // pink
];

export default function UsersPage() {
  const { dateRange, setDateRange, platform, setPlatform, userType, setUserType } = useDashboardFilters();

  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<ExtendedUserMetrics>(
    '/api/metrics/users',
    { range: dateRange, platform, userType }
  );

  const { data: categoryData, isLoading: isCategoryLoading } = useAnalytics<OnboardingCategoriesData>(
    '/api/rc/onboarding-categories',
    {}
  );

  if (isLoading) {
    return <SkeletonPage statCards={0} chartCards={3} chartCardLayout="grid-cols-1 lg:grid-cols-3" />;
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  // Prepare category data for charts
  const pieData = categoryData?.categories?.map((c) => ({
    name: c.name,
    value: c.count,
  })) ?? [];

  const barData = categoryData?.categories?.map((c) => ({
    name: c.name,
    users: c.count,
    percentage: c.percentage,
  })) ?? [];

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="User Activity"
        subtitle="User engagement and activity metrics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <ChartCard title="Daily Active Users (DAU)" subtitle="Unique users per day">
          <LineChart
            data={metrics.dau}
            xKey="date"
            lines={[{ key: 'users', color: '#10b981', name: 'DAU' }]}
          />
        </ChartCard>
        <ChartCard title="Weekly Active Users (WAU)" subtitle="Unique users per week">
          <BarChart data={metrics.wau} xKey="week" yKey="users" color="#34d399" />
        </ChartCard>
        <ChartCard title="Monthly Active Users (MAU)" subtitle="Unique users per month">
          <BarChart data={metrics.mau} xKey="month" yKey="users" color="#059669" />
        </ChartCard>
      </div>

      {/* Onboarding Use Cases Section */}
      {!isCategoryLoading && categoryData && categoryData.categories.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <StatCard
              title="Users with Use Case"
              value={categoryData.totalUsersWithCategories}
            />
            <StatCard
              title="Adoption Rate"
              value={`${categoryData.adoptionRate}%`}
            />
            <StatCard
              title="Total Users"
              value={categoryData.totalUsers}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ChartCard
              title="What Users Use Chunk For"
              subtitle="Onboarding use case selections (all time)"
            >
              <PieChart data={pieData} colors={CATEGORY_COLORS} />
            </ChartCard>
            <ChartCard
              title="Use Case Breakdown"
              subtitle="Total selections per category"
            >
              <BarChart
                data={barData}
                xKey="name"
                yKey="users"
                colors={CATEGORY_COLORS}
                horizontal
              />
            </ChartCard>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Session Duration Distribution" subtitle="How long users stay in the app">
          <BarChart data={metrics.sessionDurations} xKey="range" yKey="count" />
        </ChartCard>
        <ChartCard title="Sessions per User" subtitle="Number of sessions each user has">
          <BarChart data={metrics.sessionsPerUser} xKey="sessions" yKey="users" color="#10b981" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Geographic Distribution" subtitle="Users by country">
          <DataTable
            data={metrics.geographic}
            columns={[
              { key: 'country', header: 'Country' },
              { key: 'users', header: 'Users' },
              {
                key: 'percentage',
                header: 'Share',
                render: (value) => `${Number(value).toFixed(1)}%`,
              },
            ]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
