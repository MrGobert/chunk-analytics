// Cross-feature summary — aggregates events and unique users per feature category
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getLastUpdated, UserType } from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';
import { getFeatureActivitySnapshot } from '@/lib/feature-activity-server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const snapshot = await getFeatureActivitySnapshot({ dateRange, platform, userType });
    const { activity, fetchStatus } = snapshot;

    return NextResponse.json({
      features: activity.features,
      memoryEnabled: activity.memoryEnabled,
      deduplicatedEvents: activity.deduplicatedCount,
      dataUnavailable: fetchStatus.dataUnavailable,
      servedStale: fetchStatus.servedStale,
      dataAsOf: fetchStatus.fetchedAt,
      dateRange,
      priorRange: snapshot.priorRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching feature overview metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feature overview metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
