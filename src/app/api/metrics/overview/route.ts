import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  getUniqueUsers,
  getUniqueUsersByType,
  getUserCountsByType,
  countEvents,
  getUniqueUsersByDate,
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

    // Get user breakdown (before userType filter, but after platform filter)
    const userBreakdown = getUserCountsByType(platformFilteredEvents);

    // Calculate metrics (after all filters)
    const uniqueUsers = getUniqueUsersByType(platformFilteredEvents, userType);
    const totalUsers = uniqueUsers.size;
    const totalSessions = countEvents(events, '$ae_session') + countEvents(events, 'Session_Started');
    // Count both old and new event names for backwards compatibility
    const totalSearches = countEvents(events, 'Search Performed') + 
                          countEvents(events, 'Search') + 
                          countEvents(events, 'Search_Performed');
    
    // Count unique users who signed up (both old and new event names)
    const signupEvents = events.filter((e) => 
      e.event === 'SignUp' || 
      e.event === 'Signup_Completed' || 
      e.event === 'Account Created'
    );
    const uniqueSignups = new Set(signupEvents.map((e) => e.properties.distinct_id)).size;
    const conversionRate = totalUsers > 0 ? uniqueSignups / totalUsers : 0;

    // Calculate trends (compare to previous period)
    const rangeDaysMap: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const rangeDays = rangeDaysMap[range] || 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    let previousEvents: Awaited<ReturnType<typeof fetchMixpanelEvents>> = [];
    try {
      const allPreviousEvents = await fetchMixpanelEvents(previousFrom, previousTo);
      const previousPlatformFiltered = filterByPlatform(allPreviousEvents, platform);
      previousEvents = filterByUserType(previousPlatformFiltered, userType);
    } catch {
      // Use empty array if previous period data unavailable
    }

    const previousUsers = getUniqueUsersByType(previousEvents, userType).size;
    const previousSessions = countEvents(previousEvents, '$ae_session') + countEvents(previousEvents, 'Session_Started');
    const previousSearches = countEvents(previousEvents, 'Search Performed') + 
                             countEvents(previousEvents, 'Search') + 
                             countEvents(previousEvents, 'Search_Performed');

    const usersTrend = calculateTrend(totalUsers, previousUsers);
    const sessionsTrend = calculateTrend(totalSessions, previousSessions);
    const searchesTrend = calculateTrend(totalSearches, previousSearches);

    // Daily data
    const usersByDate = getUniqueUsersByDate(events);
    const days = getDaysInRange(dateRange.from, dateRange.to);

    const dailyData = days.map((date) => {
      const dayEvents = events.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        users: usersByDate.get(date)?.size || 0,
        sessions: dayEvents.filter((e) => e.event === '$ae_session' || e.event === 'Session_Started').length,
        searches: dayEvents.filter((e) => 
          e.event === 'Search Performed' || 
          e.event === 'Search' || 
          e.event === 'Search_Performed'
        ).length,
      };
    });

    return NextResponse.json({
      totalUsers,
      totalSessions,
      totalSearches,
      conversionRate,
      usersTrend,
      sessionsTrend,
      searchesTrend,
      dailyData,
      dateRange,
      platform,
      userType,
      userBreakdown,
      lastUpdated: getLastUpdated(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching overview metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch overview metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
