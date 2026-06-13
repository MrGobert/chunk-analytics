// Power users — segment the active base and surface the top users.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  categorizeUsers,
  getLastUpdated,
  isRealUser,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { categorizeEvent } from '@/lib/feature-categories';
import { MixpanelEvent } from '@/types/mixpanel';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    // Full export — shares the from:to cache with /users & /feature-overview.
    const raw = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFiltered = filterByPlatform(raw, platform);
    const events = filterByUserType(platformFiltered, userType);

    const days = getDaysInRange(dateRange.from, dateRange.to);
    const windowDays = Math.max(1, days.length);
    const lastDays = new Set(days.slice(-7)); // trailing 7 days for "still active"
    const subscribers = categorizeUsers(events);

    interface UserAgg { activeDays: Set<string>; featureCats: Set<string>; eventCount: number; activeInLast7: boolean }
    const agg = new Map<string, UserAgg>();

    const dayOf = (e: MixpanelEvent) => formatDate(new Date(e.properties.time * 1000));
    for (const e of events) {
      const uid = e.properties.distinct_id;
      if (!isRealUser(uid)) continue;
      if (!agg.has(uid)) agg.set(uid, { activeDays: new Set(), featureCats: new Set(), eventCount: 0, activeInLast7: false });
      const a = agg.get(uid)!;
      const d = dayOf(e);
      a.activeDays.add(d);
      a.eventCount++;
      if (lastDays.has(d)) a.activeInLast7 = true;
      const cat = categorizeEvent(e.event);
      if (cat) a.featureCats.add(cat);
    }

    let power = 0, core = 0, casual = 0, dormant = 0;
    let powerSubs = 0, coreSubs = 0, casualSubs = 0, dormantSubs = 0;
    const ranked: { uid: string; activeDays: number; features: number; events: number; subscriber: boolean }[] = [];

    for (const [uid, a] of agg) {
      const activeDays = a.activeDays.size;
      // Clamp the window to ≥1 week so sub-week ranges don't extrapolate a single
      // active day into a fake "7 days/week" and mislabel the user as Power.
      const perWeek = activeDays / (Math.max(7, windowDays) / 7);
      const isSub = subscribers.get(uid) === 'subscriber';
      let segment: 'power' | 'core' | 'casual' | 'dormant';
      if (!a.activeInLast7) segment = 'dormant';
      else if (perWeek >= 5 && a.featureCats.size >= 3) segment = 'power';
      else if (perWeek >= 2) segment = 'core';
      else segment = 'casual';

      if (segment === 'power') { power++; if (isSub) powerSubs++; }
      else if (segment === 'core') { core++; if (isSub) coreSubs++; }
      else if (segment === 'casual') { casual++; if (isSub) casualSubs++; }
      else { dormant++; if (isSub) dormantSubs++; }

      ranked.push({ uid, activeDays, features: a.featureCats.size, events: a.eventCount, subscriber: isSub });
    }

    ranked.sort((x, y) => y.activeDays - x.activeDays || y.events - x.events);
    const topUsers = ranked.slice(0, 50);

    // Feature-breadth distribution (how many distinct feature categories users touch)
    const breadth = new Map<number, number>();
    for (const a of agg.values()) {
      const n = a.featureCats.size;
      breadth.set(n, (breadth.get(n) || 0) + 1);
    }
    const featureBreadth = Array.from(breadth)
      .map(([features, users]) => ({ features: `${features}`, users }))
      .sort((a, b) => Number(a.features) - Number(b.features));

    const segments = [
      { segment: 'Power', count: power, subscribers: powerSubs, description: '≥5 active days/wk · ≥3 features' },
      { segment: 'Core', count: core, subscribers: coreSubs, description: '2–4 active days/wk' },
      { segment: 'Casual', count: casual, subscribers: casualSubs, description: 'Active, <2 days/wk' },
      { segment: 'Dormant', count: dormant, subscribers: dormantSubs, description: 'No activity in last 7d' },
    ];

    return NextResponse.json(
      {
        totalUsers: agg.size,
        segments,
        topUsers,
        featureBreadth,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching power-user metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch power-user metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
