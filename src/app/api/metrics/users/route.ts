// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserCountsByType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';
import { aggregateUserEngagement } from '@/lib/engagement';
import { getEngagementSnapshot } from '@/lib/engagement-server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const snapshot = await getEngagementSnapshot({ dateRange, platform, userType });
    const metrics = aggregateUserEngagement(snapshot.events, dateRange);
    const userBreakdown = getUserCountsByType(snapshot.events);

    const response = NextResponse.json({
      ...metrics,
      dateRange,
      platform,
      userType,
      userBreakdown,
      dataUnavailable: snapshot.fetchStatus.dataUnavailable,
      servedStale: snapshot.fetchStatus.servedStale,
      dataAsOf: snapshot.fetchStatus.fetchedAt,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching user metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user metrics' },
      { status: 500 }
    );
  }
}
