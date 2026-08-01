// Pulse — range-aware founder briefing backed by one narrow Mixpanel export.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getLastUpdated, UserType } from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';
import { aggregatePulseMetrics } from '@/lib/pulse';
import { getFeatureActivitySnapshot } from '@/lib/feature-activity-server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '7d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;
    const dateRange = from && to ? { from, to } : getDateRange(range);
    const snapshot = await getFeatureActivitySnapshot({ dateRange, platform, userType });
    const metrics = aggregatePulseMetrics(snapshot.events, {
      currentDays: snapshot.currentDays,
      priorDays: snapshot.priorDays,
      today: dateRange.to,
      featureActivity: snapshot.activity,
    });
    const { dataUnavailable, servedStale, fetchedAt } = snapshot.fetchStatus;

    return NextResponse.json(
      {
        ...metrics,
        dateRange,
        platform,
        userType,
        dataUnavailable,
        servedStale,
        dataAsOf: fetchedAt,
        ...(dataUnavailable
          ? { note: 'Mixpanel activity is temporarily unavailable. Try refreshing.' }
          : servedStale
            ? { note: `Showing the most recent cached Mixpanel snapshot${fetchedAt ? ` from ${fetchedAt}` : ''}.` }
            : {}),
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
