// Engagement command center — one narrow Mixpanel snapshot for the whole page.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getLastUpdated, type UserType } from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';
import {
  aggregateAdvancedEngagement,
  aggregatePowerUsers,
  aggregateUserEngagement,
} from '@/lib/engagement';
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
    const lastUpdated = getLastUpdated();

    return NextResponse.json(
      {
        users: {
          ...aggregateUserEngagement(snapshot.events, dateRange),
          lastUpdated,
        },
        advanced: {
          ...aggregateAdvancedEngagement(snapshot.events, dateRange),
          lastUpdated,
        },
        power: {
          ...aggregatePowerUsers(snapshot.events, dateRange),
          dateRange,
          lastUpdated,
        },
        dateRange,
        platform,
        userType,
        dataUnavailable: snapshot.fetchStatus.dataUnavailable,
        servedStale: snapshot.fetchStatus.servedStale,
        dataAsOf: snapshot.fetchStatus.fetchedAt,
        lastUpdated,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching engagement metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch engagement metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
