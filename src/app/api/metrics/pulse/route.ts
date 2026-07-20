// Pulse — range-aware founder briefing backed by one narrow Mixpanel export.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFilteredWithStatus,
  filterByPlatform,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, shiftDate } from '@/lib/utils';
import { aggregatePulseMetrics, PULSE_EVENT_NAMES } from '@/lib/pulse';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '7d';
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;
    const dateRange = getDateRange(range);
    const currentDays = getDaysInRange(dateRange.from, dateRange.to);
    const priorTo = shiftDate(dateRange.from, -1);
    const priorFrom = shiftDate(priorTo, -(currentDays.length - 1));

    // Today-vs-last-week context is required even for the 1-day view.
    const sameWeekdayFrom = shiftDate(dateRange.to, -7);
    const exportFrom = priorFrom < sameWeekdayFrom ? priorFrom : sameWeekdayFrom;
    const { events: rawEvents, dataUnavailable } = await fetchMixpanelEventsFilteredWithStatus(
      exportFrom,
      dateRange.to,
      PULSE_EVENT_NAMES,
    );
    const platformFiltered = filterByPlatform(rawEvents, platform);
    const events = filterByUserType(platformFiltered, userType);
    const metrics = aggregatePulseMetrics(events, {
      currentDays,
      priorDays: getDaysInRange(priorFrom, priorTo),
      today: dateRange.to,
    });

    return NextResponse.json(
      {
        ...metrics,
        dateRange,
        platform,
        userType,
        dataUnavailable,
        ...(dataUnavailable ? { note: 'Mixpanel activity is temporarily unavailable. Try refreshing.' } : {}),
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching pulse metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pulse metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
