// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getUniqueUsers,
  calculateTrend,
  getLastUpdated,
  getPropertyDistribution,
  groupEventsByDate,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

const HELP_CENTER_EVENTS = [
  'Help_Page_Viewed',
  'Help_CTA_Clicked',
  'Help_Related_Link_Clicked',
  'Help_FAQ_Opened',
  'Help_Sidebar_Nav_Clicked',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);

    // Previous period dates (computed before fetch so both can run in parallel)
    const rangeDays = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : range === '365d' ? 365 : 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    // Fetch current and previous period in parallel
    const [allEvents, allPreviousEvents] = await Promise.all([
      fetchMixpanelEvents(dateRange.from, dateRange.to),
      fetchMixpanelEvents(previousFrom, previousTo).catch(() => [] as Awaited<ReturnType<typeof fetchMixpanelEvents>>),
    ]);

    const helpEvents = filterEventsByType(
      filterByUserType(filterByPlatform(allEvents, platform), userType),
      HELP_CENTER_EVENTS,
    );
    const prevHelp = filterEventsByType(
      filterByUserType(filterByPlatform(allPreviousEvents, platform), userType),
      HELP_CENTER_EVENTS,
    );

    // Pre-filter by event type once — avoids redundant scans
    const pageViewEvents = helpEvents.filter((e) => e.event === 'Help_Page_Viewed');
    const faqEvents = helpEvents.filter((e) => e.event === 'Help_FAQ_Opened');
    const navEvents = helpEvents.filter((e) => e.event === 'Help_Sidebar_Nav_Clicked');

    // Summary counts (derived from pre-filtered arrays)
    const totalViews = pageViewEvents.length;
    const uniqueUsers = getUniqueUsers(helpEvents).size;
    const faqOpens = faqEvents.length;
    const ctaClicks = helpEvents.filter((e) => e.event === 'Help_CTA_Clicked').length;

    // Trends
    const prevPageViews = prevHelp.filter((e) => e.event === 'Help_Page_Viewed').length;
    const prevFaqOpens = prevHelp.filter((e) => e.event === 'Help_FAQ_Opened').length;
    const prevCtaClicks = prevHelp.filter((e) => e.event === 'Help_CTA_Clicked').length;
    const viewsTrend = calculateTrend(totalViews, prevPageViews);
    const uniqueUsersTrend = calculateTrend(uniqueUsers, getUniqueUsers(prevHelp).size);
    const faqOpensTrend = calculateTrend(faqOpens, prevFaqOpens);
    const ctaClicksTrend = calculateTrend(ctaClicks, prevCtaClicks);

    // Page view distribution — use existing utility
    const pageViewDistribution = Array.from(getPropertyDistribution(pageViewEvents, 'page'))
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // FAQ category distribution — use existing utility
    const faqCategoryDistribution = Array.from(getPropertyDistribution(faqEvents, 'category'))
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Top FAQ questions — needs custom logic for two-field aggregation
    const questionCounts = new Map<string, { category: string; count: number }>();
    for (const e of faqEvents) {
      const question = (e.properties.question as string) || 'Unknown';
      const category = (e.properties.category as string) || 'Uncategorized';
      const existing = questionCounts.get(question);
      if (existing) {
        existing.count += 1;
      } else {
        questionCounts.set(question, { category, count: 1 });
      }
    }
    const topFaqQuestions = Array.from(questionCounts.entries())
      .map(([question, { category, count }]) => ({ question, category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Navigation destinations — use existing utility
    const navDestinations = Array.from(getPropertyDistribution(navEvents, 'destination'))
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => b.count - a.count);

    // Daily data — pre-group once (O(n)) instead of filtering per day (O(n*d))
    const grouped = groupEventsByDate(helpEvents);
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = grouped.get(date) || [];
      return {
        date,
        views: dayEvents.filter((e) => e.event === 'Help_Page_Viewed').length,
        faqOpens: dayEvents.filter((e) => e.event === 'Help_FAQ_Opened').length,
        ctaClicks: dayEvents.filter((e) => e.event === 'Help_CTA_Clicked').length,
      };
    });

    return NextResponse.json(
      {
        totalViews,
        uniqueUsers,
        faqOpens,
        ctaClicks,
        viewsTrend,
        uniqueUsersTrend,
        faqOpensTrend,
        ctaClicksTrend,
        pageViewDistribution,
        faqCategoryDistribution,
        topFaqQuestions,
        navDestinations,
        dailyData,
        lastUpdated: getLastUpdated(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching help center metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch help center metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
