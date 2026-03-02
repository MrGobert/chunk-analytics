'use client';

import DateRangePicker from '@/components/ui/DateRangePicker';
import PlatformFilter from '@/components/ui/PlatformFilter';
import UserTypeFilter from '@/components/ui/UserTypeFilter';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  dateRange: string;
  onDateRangeChange: (range: string) => void;
  platform?: string;
  onPlatformChange?: (platform: string) => void;
  userType?: string;
  onUserTypeChange?: (userType: string) => void;
  lastUpdated?: string;
  isRefreshing?: boolean;
}

export default function PageHeader({
  title,
  subtitle,
  dateRange,
  onDateRangeChange,
  platform,
  onPlatformChange,
  userType,
  onUserTypeChange,
  lastUpdated,
  isRefreshing,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-zinc-400 mt-1">{subtitle}</p>}
        <div className="flex items-center gap-2 mt-2">
          {lastUpdated && (
            <p className="text-xs text-zinc-500">
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </p>
          )}
          {isRefreshing && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              Refreshing...
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {userType !== undefined && onUserTypeChange && (
          <UserTypeFilter value={userType} onChange={onUserTypeChange} />
        )}
        {platform !== undefined && onPlatformChange && (
          <PlatformFilter value={platform} onChange={onPlatformChange} />
        )}
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
      </div>
    </div>
  );
}
