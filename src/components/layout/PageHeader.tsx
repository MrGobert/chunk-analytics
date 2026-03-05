'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const ctx = gsap.context(() => {
      gsap.fromTo('.header-animate',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, stagger: 0.08, ease: 'power3.out' }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [title]);

  return (
    <div ref={containerRef} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
      <div>
        <h1 className="header-animate text-3xl md:text-4xl font-bold font-sans tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="header-animate text-zinc-400 mt-2 font-medium">{subtitle}</p>}
        <div className="flex items-center gap-2 mt-3 header-animate">
          {mounted && lastUpdated && (
            <p className="text-xs font-mono text-zinc-500">
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </p>
          )}
          {isRefreshing && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-accent/10 text-accent border border-accent/20">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Refreshing...
            </span>
          )}
        </div>
      </div>
      <div className="header-animate flex flex-wrap items-center gap-3">
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
