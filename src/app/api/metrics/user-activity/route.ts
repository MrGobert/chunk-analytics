// Per-user activity — Mixpanel events for a single distinct_id (Firebase UID).
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { fetchMixpanelEventsWithStatus, getLastUpdated, normalizeEventName } from '@/lib/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { categorizeEvent } from '@/lib/feature-categories';
import {
  countCustomerUsage,
  eventsOnOrAfter,
  filterCustomerEvents,
} from '@/lib/customer-activity';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const uid = searchParams.get('uid');
    if (!uid) {
      return NextResponse.json({ error: 'Missing required "uid" parameter' }, { status: 400 });
    }
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const monthStart = `${dateRange.to.slice(0, 7)}-01`;
    const exportFrom = monthStart < dateRange.from ? monthStart : dateRange.from;
    // Full export — shares the from:to cache with /users, /power-users, etc.
    // Include the whole calendar month even on day 31 so "This month's
    // usage" never drops the first day while the activity card stays rolling.
    const {
      events: raw,
      dataUnavailable,
      servedStale,
      fetchedAt,
    } = await fetchMixpanelEventsWithStatus(exportFrom, dateRange.to);
    const customerEvents = filterCustomerEvents(raw, uid);
    const events = eventsOnOrAfter(customerEvents, dateRange.from);

    const activeDays = new Set<string>();
    const byCategory = new Map<string, number>();
    const eventCounts = new Map<string, number>();
    let lastSeenTs = 0;

    for (const e of events) {
      activeDays.add(formatDate(new Date(e.properties.time * 1000)));
      if (e.properties.time > lastSeenTs) lastSeenTs = e.properties.time;
      const cat = categorizeEvent(e.event);
      if (cat) byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
      const name = normalizeEventName(e.event);
      eventCounts.set(name, (eventCounts.get(name) || 0) + 1);
    }

    const topEvents = Array.from(eventCounts)
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return NextResponse.json(
      {
        uid,
        totalEvents: events.length,
        activeDays: activeDays.size,
        lastSeen: lastSeenTs ? new Date(lastSeenTs * 1000).toISOString() : null,
        byCategory: Array.from(byCategory)
          .map(([category, count]) => ({ category, events: count }))
          .sort((a, b) => b.events - a.events),
        topEvents,
        usageStats: countCustomerUsage(events),
        monthToDateUsageStats: countCustomerUsage(eventsOnOrAfter(customerEvents, monthStart)),
        dateRange,
        dataUnavailable,
        servedStale,
        dataAsOf: fetchedAt,
        lastUpdated: fetchedAt || getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching user activity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user activity', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
