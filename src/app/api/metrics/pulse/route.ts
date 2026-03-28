// Lightweight pulse endpoint — fetches only 7 days for fast homepage loading
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  countEventsNormalized,
  getUniqueUsersByDate,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    // Always fetch only 7 days — this is the whole point of the pulse endpoint
    const dateRange = getDateRange('7d');
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);

    // Exclude marketing sessions from app user counts
    const appEvents = events.filter(e => e.event !== 'Marketing_Session_Started');

    // Today's date in the same timezone as formatDate
    const today = formatDate(new Date());
    const yesterday = getDaysInRange(dateRange.from, dateRange.to).slice(-2)[0] || today;

    // DAU by date
    const usersByDate = getUniqueUsersByDate(appEvents);
    const todayDAU = usersByDate.get(today)?.size || 0;
    const yesterdayDAU = usersByDate.get(yesterday)?.size || 0;

    // Today's searches
    const todayEvents = appEvents.filter(e => formatDate(new Date(e.properties.time * 1000)) === today);
    const todaySearches = countEventsNormalized(todayEvents, 'Search_Performed');

    // 7-day DAU trend
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dauTrend7d = days.map(date => ({
      date,
      users: usersByDate.get(date)?.size || 0,
    }));

    return NextResponse.json({
      todayDAU,
      yesterdayDAU,
      todaySearches,
      dauTrend7d,
      lastUpdated: getLastUpdated(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching pulse metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pulse metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
