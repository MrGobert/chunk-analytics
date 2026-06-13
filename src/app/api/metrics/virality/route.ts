// Virality — shared content → views → save-to-Chunk → signups.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  getLastUpdated,
  normalizeEventName,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { buildFunnel } from '@/lib/funnel';
import { MixpanelEvent } from '@/types/mixpanel';

const SHARE_EVENTS = ['Note_Shared', 'Note_Published', 'Research_Report_Shared', 'Research_Published', 'Collection_Shared', 'Conversation_Shared', 'Conversation_Published', 'Artifact_Shared'];
const VIEW_EVENTS = ['Shared_Note_Viewed', 'Shared_Conversation_Viewed', 'Shared_Research_Viewed', 'Shared_Collection_Viewed', 'Shared_Artifact_Viewed'];
const SAVE_EVENTS = ['Save_To_Chunk_Clicked'];
const SIGNUP_EVENTS = ['Signup_Completed', 'SignUp', 'Account Created'];

const VIRALITY_EVENTS = [...SHARE_EVENTS, ...VIEW_EVENTS, ...SAVE_EVENTS, ...SIGNUP_EVENTS];

const SHARE_TYPE: Record<string, string> = {
  Note_Shared: 'Note', Note_Published: 'Note',
  Research_Report_Shared: 'Research', Research_Published: 'Research',
  Collection_Shared: 'Collection',
  Conversation_Shared: 'Conversation', Conversation_Published: 'Conversation',
  Artifact_Shared: 'Artifact',
};
const VIEW_TYPE: Record<string, string> = {
  Shared_Note_Viewed: 'Note', Shared_Conversation_Viewed: 'Conversation',
  Shared_Research_Viewed: 'Research', Shared_Collection_Viewed: 'Collection',
  Shared_Artifact_Viewed: 'Artifact',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const events = await fetchMixpanelEventsFiltered(dateRange.from, dateRange.to, VIRALITY_EVENTS);

    const isShare = (e: MixpanelEvent) => SHARE_EVENTS.includes(e.event);
    const isView = (e: MixpanelEvent) => VIEW_EVENTS.includes(e.event);
    const isSave = (e: MixpanelEvent) => e.event === 'Save_To_Chunk_Clicked';
    const isSignup = (e: MixpanelEvent) => SIGNUP_EVENTS.includes(normalizeEventName(e.event)) || SIGNUP_EVENTS.includes(e.event);

    const sharesCreated = events.filter(isShare).length;
    const sharedViews = events.filter(isView).length;
    const saveClicks = events.filter(isSave).length;

    // Viral signups: a viewer who later signed up (same distinct_id, first view before signup).
    const firstViewTime = new Map<string, number>();
    for (const e of events.filter(isView)) {
      const uid = e.properties.distinct_id;
      const t = e.properties.time as number;
      if (!firstViewTime.has(uid) || t < firstViewTime.get(uid)!) firstViewTime.set(uid, t);
    }
    const viralSignupUsers = new Set<string>();
    for (const e of events.filter(isSignup)) {
      const uid = e.properties.distinct_id;
      const vt = firstViewTime.get(uid);
      if (vt !== undefined && (e.properties.time as number) >= vt) viralSignupUsers.add(uid);
    }
    const viralSignups = viralSignupUsers.size;

    const funnel = buildFunnel([
      { name: 'Shares Created', count: sharesCreated },
      { name: 'Shared Views', count: sharedViews },
      { name: 'Save-to-Chunk Clicks', count: saveClicks },
      { name: 'Viral Signups', count: viralSignups },
    ]);

    // Shares + views by content type
    const shareByType = new Map<string, number>();
    for (const e of events.filter(isShare)) {
      const t = SHARE_TYPE[e.event] || 'Other';
      shareByType.set(t, (shareByType.get(t) || 0) + 1);
    }
    const viewByType = new Map<string, number>();
    for (const e of events.filter(isView)) {
      const t = VIEW_TYPE[e.event] || 'Other';
      viewByType.set(t, (viewByType.get(t) || 0) + 1);
    }
    const allTypes = new Set([...shareByType.keys(), ...viewByType.keys()]);
    const byType = Array.from(allTypes).map((t) => {
      const shares = shareByType.get(t) || 0;
      const views = viewByType.get(t) || 0;
      return { type: t, shares, views, viewsPerShare: shares > 0 ? Math.round((views / shares) * 10) / 10 : 0 };
    }).sort((a, b) => b.views - a.views);

    // Daily series
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const de = events.filter((e) => formatDate(new Date(e.properties.time * 1000)) === date);
      return {
        date,
        shares: de.filter(isShare).length,
        views: de.filter(isView).length,
        saves: de.filter(isSave).length,
      };
    });

    return NextResponse.json(
      {
        kpis: {
          sharesCreated,
          sharedViews,
          saveClicks,
          viralSignups,
          viewsPerShare: sharesCreated > 0 ? Math.round((sharedViews / sharesCreated) * 10) / 10 : 0,
          saveRate: sharedViews > 0 ? saveClicks / sharedViews : 0,
        },
        funnel,
        byType,
        dailyData,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching virality metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch virality metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
