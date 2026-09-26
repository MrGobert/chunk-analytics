import { NextRequest, NextResponse } from 'next/server';
import { getJourneySnapshot } from '@/lib/journey-server';
import { getDateRange } from '@/lib/utils';
import { getLastUpdated, type UserType } from '@/lib/mixpanel';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const from = params.get('from');
    const to = params.get('to');
    const dateRange = from && to ? { from, to } : getDateRange(params.get('range') || '30d');
    const { metrics } = await getJourneySnapshot({ dateRange, platform: params.get('platform') || 'all', userType: (params.get('userType') || 'all') as UserType });
    return NextResponse.json({ ...metrics, lastUpdated: getLastUpdated() }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (error) {
    console.error('Error fetching journey metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch new-user journey metrics' }, { status: 500 });
  }
}
