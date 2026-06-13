'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import DateRangePicker from '@/components/ui/DateRangePicker';
import PlatformFilter from '@/components/ui/PlatformFilter';
import UserTypeFilter from '@/components/ui/UserTypeFilter';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  dateRange?: string;
  onDateRangeChange?: (range: string) => void;
  platform?: string;
  onPlatformChange?: (platform: string) => void;
  userType?: string;
  onUserTypeChange?: (userType: string) => void;
  lastUpdated?: string;
  isRefreshing?: boolean;
  /** Replace the standard date/platform/user filters with custom controls. */
  controls?: ReactNode;
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
  controls,
}: PageHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const ctx = gsap.context(() => {
      // "Settle, don't snap" — paper sliding across a desk.
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '.header-animate',
          { y: 28, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' }
        );
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.fromTo('.header-animate', { opacity: 0 }, { opacity: 1, duration: 0.3 });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [title]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8"
    >
      <div>
        <h1 className="header-animate font-display text-3xl md:text-4xl text-ink">{title}</h1>
        {subtitle && <p className="header-animate text-ink-soft mt-2">{subtitle}</p>}
        <div className="flex items-center gap-2 mt-3 header-animate">
          {mounted && lastUpdated && (
            <p className="text-xs font-mono text-ink-faint">
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </p>
          )}
          {isRefreshing && (
            <span className="sticker !py-1 !px-2.5 text-xs bg-butter-tint border-butter/50 text-ink-soft">
              <span className="w-1.5 h-1.5 rounded-full bg-butter animate-pulse" />
              Refreshing…
            </span>
          )}
        </div>
      </div>
      <div className="header-animate flex flex-wrap items-center gap-3">
        {controls ? (
          controls
        ) : (
          <>
            {userType !== undefined && onUserTypeChange && (
              <UserTypeFilter value={userType} onChange={onUserTypeChange} />
            )}
            {platform !== undefined && onPlatformChange && (
              <PlatformFilter value={platform} onChange={onPlatformChange} />
            )}
            {dateRange !== undefined && onDateRangeChange && (
              <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
