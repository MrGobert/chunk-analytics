// Per-user activity — Mixpanel events for a single distinct_id (Firebase UID).
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { fetchMixpanelEventsWithStatus, getLastUpdated, normalizeEventName } from '@/lib/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { categorizeEvent } from '@/lib/feature-categories';

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
    // Full export — shares the from:to cache with /users, /power-users, etc.
    const { events: raw, dataUnavailable } = await fetchMixpanelEventsWithStatus(dateRange.from, dateRange.to);
    const events = raw.filter((e) => e.properties.distinct_id === uid);

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
        dateRange,
        dataUnavailable,
        lastUpdated: getLastUpdated(),
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
