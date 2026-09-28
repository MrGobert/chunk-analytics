// Starters — the chat-starter cards above an empty chat (personalized for Pro +
// Memory, otherwise the generic catalog), on web and Apple. Card events fire
// client-side with identical names on both, so this route rolls them up
// together. All aggregation lives in src/lib/chat-starters.ts; this route only
// fetches the narrow export and applies the dashboard filters.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  expandEventNames,
  fetchMixpanelEventsFilteredWithStatus,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';
import { ENGAGEMENT_USER_CONTEXT_EVENTS } from '@/lib/engagement';
import { buildChatStartersMetrics, CHAT_STARTER_EVENTS } from '@/lib/chat-starters';

// Classification context must ride along or userType filters see only visitors.
const CHAT_STARTERS_EXPORT_EVENT_NAMES = expandEventNames([
  ...CHAT_STARTER_EVENTS,
  ...ENGAGEMENT_USER_CONTEXT_EVENTS,
]);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const status = await fetchMixpanelEventsFilteredWithStatus(
      dateRange.from,
      dateRange.to,
      CHAT_STARTERS_EXPORT_EVENT_NAMES,
    );

    return NextResponse.json(
      buildChatStartersMetrics(status.events, {
        dateRange,
        platform,
        userType,
        fetch: status,
        lastUpdated: getLastUpdated(),
      }),
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching chat starters metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch chat starters metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
