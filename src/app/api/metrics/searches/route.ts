// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getPropertyDistribution,
  calculateTrend,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFilteredEvents = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFilteredEvents, userType);

    // Include both old and new event names for backwards compatibility
    const searchEvents = filterEventsByType(events, ['Search Performed', 'Search', 'Search_Performed']);

    // Previous period for trend
    const rangeDays = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : range === '365d' ? 365 : 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    let previousEvents: Awaited<ReturnType<typeof fetchMixpanelEvents>> = [];
    try {
      const allPreviousEvents = await fetchMixpanelEvents(previousFrom, previousTo);
      const prevPlatformFiltered = filterByPlatform(allPreviousEvents, platform);
      previousEvents = filterByUserType(prevPlatformFiltered, userType);
    } catch {
      // Use empty array if previous period data unavailable
    }

    const prevSearchEvents = filterEventsByType(previousEvents, ['Search Performed', 'Search', 'Search_Performed']);
    const searchTrend = calculateTrend(searchEvents.length, prevSearchEvents.length);

    // Searches over time
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const searchesOverTime = days.map((date) => {
      const daySearches = searchEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });
      return { date, searches: daySearches.length };
    });

    // Search modes breakdown
    const modesDistribution = getPropertyDistribution(searchEvents, 'search_mode');
    const searchModes = Array.from(modesDistribution.entries())
      .map(([mode, count]) => ({ mode: mode || 'Auto', count }))
      .sort((a, b) => b.count - a.count);

    // Models used
    const modelsDistribution = getPropertyDistribution(searchEvents, 'model_used');
    const modelsUsed = Array.from(modelsDistribution.entries())
      .map(([model, count]) => ({ model: model || 'Default', count }))
      .sort((a, b) => b.count - a.count);

    // Context usage
    const withContext = searchEvents.filter((e) => e.properties.has_context === true).length;
    const withoutContext = searchEvents.length - withContext;
    const contextUsage = [
      { hasContext: true, count: withContext },
      { hasContext: false, count: withoutContext },
    ];

    // Hourly distribution
    const hourlyCount = new Array(24).fill(0);
    for (const event of searchEvents) {
      const hour = new Date(event.properties.time * 1000).getHours();
      hourlyCount[hour]++;
    }
    const hourlyDistribution = hourlyCount.map((count, hour) => ({ hour, count }));

    const response = NextResponse.json({
      searchesOverTime,
      searchModes,
      modelsUsed,
      contextUsage,
      hourlyDistribution,
      totalSearches: searchEvents.length,
      searchTrend,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', allEvents.length > 0 ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
    return response;
  } catch (error) {
    console.error('Error fetching search metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch search metrics' },
      { status: 500 }
    );
  }
}
