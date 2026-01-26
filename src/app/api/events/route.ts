import { NextRequest, NextResponse } from 'next/server';
import { fetchMixpanelEvents, getLastUpdated } from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const events = await fetchMixpanelEvents(dateRange.from, dateRange.to);

    return NextResponse.json({
      events,
      count: events.length,
      dateRange,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}
