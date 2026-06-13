// Pulse — daily briefing. Fetches a 14-day window for trend + same-weekday delta
// + week-over-week creator/top-mover math, all from one full export.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  countEvents,
  getUniqueUsersByDate,
  getLastUpdated,
  calculateTrend,
  normalizeEventName,
  isRealUser,
  UserType,
} from '@/lib/mixpanel';
import { getDaysInRange, formatDate } from '@/lib/utils';
import { categorizeEvent, KEY_ACTION_EVENTS } from '@/lib/feature-categories';
import { MixpanelEvent } from '@/types/mixpanel';

const KEY_ACTIONS = new Set(KEY_ACTION_EVENTS);

/** Unique users who performed ≥1 key creator action within the given events. */
function activeCreators(events: MixpanelEvent[]): Set<string> {
  const users = new Set<string>();
  for (const e of events) {
    // Exclude guest/anonymous/device ids so the north-star count matches the
    // population used by power-users segmentation.
    if (KEY_ACTIONS.has(normalizeEventName(e.event)) && isRealUser(e.properties.distinct_id)) {
      users.add(e.properties.distinct_id);
    }
  }
  return users;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    // 14-day window: trailing 7d vs prior 7d, plus a 14d DAU trend.
    // getDateRange has no '14d' case, so build it explicitly.
    const to = formatDate(new Date());
    const range14 = { from: formatDate(new Date(Date.now() - 13 * 86400000)), to };

    const allEvents = await fetchMixpanelEvents(range14.from, range14.to);
    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);

    // App engagement excludes marketing-only sessions.
    const appEvents = events.filter((e) => e.event !== 'Marketing_Session_Started');

    const days = getDaysInRange(range14.from, range14.to); // 14 entries, oldest → newest
    const today = days[days.length - 1] || to;
    const yesterday = days[days.length - 2] || today;
    const sameWeekdayLastWeek = days[days.length - 8] || yesterday;

    // ---- DAU ----
    const usersByDate = getUniqueUsersByDate(appEvents);
    const todayDAU = usersByDate.get(today)?.size || 0;
    const yesterdayDAU = usersByDate.get(yesterday)?.size || 0;
    const sameWeekdayDAU = usersByDate.get(sameWeekdayLastWeek)?.size || 0;
    const dauTrend14d = days.map((date) => ({ date, users: usersByDate.get(date)?.size || 0 }));
    const dauTrend7d = dauTrend14d.slice(-7); // back-compat

    // ---- Window splits ----
    const last7Days = new Set(days.slice(-7));
    const prev7Days = new Set(days.slice(0, 7));
    const eventDay = (e: MixpanelEvent) => formatDate(new Date(e.properties.time * 1000));
    const last7Events = appEvents.filter((e) => last7Days.has(eventDay(e)));
    const prev7Events = appEvents.filter((e) => prev7Days.has(eventDay(e)));
    const todayEvents = appEvents.filter((e) => eventDay(e) === today);

    // ---- North star: Weekly Active Creators (trailing 7d) ----
    const weeklyActiveCreators = activeCreators(last7Events).size;
    const weeklyActiveCreatorsPrev = activeCreators(prev7Events).size;
    const wacChange = calculateTrend(weeklyActiveCreators, weeklyActiveCreatorsPrev);

    // ---- Today counters ----
    const todaySearches = countEvents(todayEvents, 'Search_Performed');
    const todaySignups = countEvents(todayEvents, 'Signup_Completed');
    const todayPurchases = countEvents(todayEvents, 'Purchase_Completed');
    const todayPurchaseFailures = todayEvents.filter((e) => e.event === 'Purchase_Failed').length;
    const todayPaywallViews = new Set(
      todayEvents.filter((e) => e.event === 'Paywall_Viewed').map((e) => e.properties.distinct_id),
    ).size;
    const todayTrialStarts = todayEvents.filter(
      (e) =>
        e.event === 'Purchase_Initiated' &&
        (e.properties.is_trial === true || e.properties.has_trial === true),
    ).length;

    // ---- Search reliability: today vs trailing-7d daily average ----
    const searchFailRate = (evts: MixpanelEvent[]) => {
      const ok = countEvents(evts, 'Search_Performed');
      const failed = evts.filter((e) => e.event === 'Search_Failed').length;
      const denom = ok + failed;
      return denom > 0 ? failed / denom : 0;
    };
    const searchFailRateToday = searchFailRate(todayEvents);
    const searchFailRate7d = searchFailRate(last7Events);

    // ---- Today micro-funnel (unique users) ----
    const uniqToday = (evtName: string) =>
      new Set(todayEvents.filter((e) => e.event === evtName).map((e) => e.properties.distinct_id)).size;
    const microFunnel = {
      paywallViewed: todayPaywallViews,
      planSelected: uniqToday('Plan_Selected'),
      purchaseInitiated: uniqToday('Purchase_Initiated'),
      purchaseCompleted: uniqToday('Purchase_Completed'),
    };

    // ---- Top movers: feature-category event volume, last 7d vs prior 7d ----
    const catVolume = (evts: MixpanelEvent[]) => {
      const m = new Map<string, number>();
      for (const e of evts) {
        const cat = categorizeEvent(e.event);
        if (cat) m.set(cat, (m.get(cat) || 0) + 1);
      }
      return m;
    };
    const lastCat = catVolume(last7Events);
    const prevCat = catVolume(prev7Events);
    const allCats = new Set([...lastCat.keys(), ...prevCat.keys()]);
    const movers = Array.from(allCats)
      .map((cat) => {
        const current = lastCat.get(cat) || 0;
        const previous = prevCat.get(cat) || 0;
        return { category: cat, current, previous, change: calculateTrend(current, previous) };
      })
      // Only movers with meaningful volume + a computable change
      .filter((m) => (m.current >= 5 || m.previous >= 5) && m.change !== null);
    const gainers = [...movers].filter((m) => (m.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 3);
    const decliners = [...movers].filter((m) => (m.change ?? 0) < 0).sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 3);

    return NextResponse.json(
      {
        // back-compat fields
        todayDAU,
        yesterdayDAU,
        todaySearches,
        dauTrend7d,
        // new fields
        sameWeekdayDAU,
        dauTrend14d,
        weeklyActiveCreators,
        weeklyActiveCreatorsPrev,
        wacChange,
        todaySignups,
        todayTrialStarts,
        todayPurchases,
        todayPurchaseFailures,
        todayPaywallViews,
        searchFailRateToday,
        searchFailRate7d,
        microFunnel,
        topMovers: { gainers, decliners },
        lastUpdated: getLastUpdated(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching pulse metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pulse metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
