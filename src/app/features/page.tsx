'use client';

import { useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import ChartCard from '@/components/cards/ChartCard';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import { FeatureMetrics } from '@/types/mixpanel';

const FEATURE_COLORS: Record<string, string> = {
  'Tab View': '#8b5cf6',
  Notes: '#6366f1',
  Documents: '#3b82f6',
  Images: '#0ea5e9',
  Maps: '#14b8a6',
  'AI Memory': '#22c55e',
  'Image Generation': '#eab308',
  AISelection: '#f97316',
  'Memory Management Viewed': '#ef4444',
  'Keyboard Shortcut Used': '#ec4899',
};

export default function FeaturesPage() {
  const [dateRange, setDateRange] = useState('30d');
  const [platform, setPlatform] = useState('all');
  const [userType, setUserType] = useState('all');

  const { data: metrics, isLoading, isRefreshing, lastUpdated } = useAnalytics<FeatureMetrics>(
    '/api/metrics/features',
    { range: dateRange, platform, userType }
  );

  if (isLoading) {
    return <SkeletonPage statCards={0} chartCards={3} chartCardLayout="grid-cols-1" />;
  }

  if (!metrics) {
    return (
      <div className="text-center text-zinc-400 py-20">
        Failed to load metrics. Please try again.
      </div>
    );
  }

  const topFeatures = metrics.featureUsage.slice(0, 5);
  const lineKeys = topFeatures.map((f) => ({
    key: f.feature,
    color: FEATURE_COLORS[f.feature] || '#8b5cf6',
    name: f.feature,
  }));

  return (
    <div className="animate-in fade-in duration-300">
      <PageHeader
        title="Feature Usage"
        subtitle="How users interact with app features"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        userType={userType}
        onUserTypeChange={setUserType}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Feature Usage Breakdown" subtitle="Total usage by feature">
          <BarChart
            data={metrics.featureUsage}
            xKey="feature"
            yKey="count"
            horizontal
            colors={metrics.featureUsage.map((f) => FEATURE_COLORS[f.feature] || '#8b5cf6')}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <ChartCard title="Feature Adoption Over Time" subtitle="Daily usage of top features">
          <LineChart data={metrics.featureOverTime} xKey="date" lines={lineKeys} showLegend />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ChartCard title="Feature Usage by Platform" subtitle="Breakdown by user segment">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-full overflow-auto">
            {metrics.featuresBySegment.map((segment) => (
              <div key={segment.segment} className="space-y-3">
                <h4 className="text-sm font-medium text-zinc-300">{segment.segment}</h4>
                <div className="space-y-2">
                  {segment.features.slice(0, 5).map((f) => (
                    <div key={f.feature} className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400 truncate max-w-[150px]">
                        {f.feature}
                      </span>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 rounded"
                          style={{
                            width: `${Math.min((f.count / (segment.features[0]?.count || 1)) * 60, 60)}px`,
                            backgroundColor: FEATURE_COLORS[f.feature] || '#8b5cf6',
                          }}
                        />
                        <span className="text-sm text-white font-medium w-12 text-right">
                          {f.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
