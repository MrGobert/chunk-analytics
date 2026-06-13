// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  countEvents,
  calculateTrend,
  getLastUpdated,
  getPropertyDistribution,
  referrerHost,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate, safeDiv } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';
import { subDays } from 'date-fns';

/** Sort a value→count map into a descending { source, sessions } list. */
function toSourceList(counts: Map<string, number>): { source: string; sessions: number }[] {
  return Array.from(counts.entries())
    .map(([source, sessions]) => ({ source, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

/** Count events by a string property, skipping events where it is absent or non-string. */
function distributionByProp(events: MixpanelEvent[], prop: string): { source: string; sessions: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const value = e.properties[prop];
    if (typeof value === 'string' && value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return toSourceList(counts);
}

const MARKETING_EVENTS = [
  'Try_For_Free_Clicked',
  'Create_Account_Clicked',
  'Feature_Page_Visited',
  'Guest_Signup_Prompt',
  'Feature_Limit_Reached',
  'Paywall_Dismissed',
  'Paywall Dismissed',
  'Marketing_Session_Started',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFilteredEvents = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFilteredEvents, userType);

    const marketingEvents = filterEventsByType(events, MARKETING_EVENTS);

    // Summary counts
    const tryForFreeClicks = countEvents(marketingEvents, 'Try_For_Free_Clicked');
    const createAccountClicks = countEvents(marketingEvents, 'Create_Account_Clicked');
    const totalCTAClicks = tryForFreeClicks + createAccountClicks;
    const featurePagesVisited = countEvents(marketingEvents, 'Feature_Page_Visited');
    const guestSignupPrompts = countEvents(marketingEvents, 'Guest_Signup_Prompt');
    const paywallDismissals = countEvents(marketingEvents, 'Paywall_Dismissed') + countEvents(marketingEvents, 'Paywall Dismissed');
    const featureLimitReached = countEvents(marketingEvents, 'Feature_Limit_Reached');
    const marketingSessions = countEvents(marketingEvents, 'Marketing_Session_Started');

    // Previous period for trends
    const rangeDays = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : range === '365d' ? 365 : 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    let previousEvents: Awaited<ReturnType<typeof fetchMixpanelEvents>> = [];
    try {
      const allPreviousEvents = await fetchMixpanelEvents(previousFrom, previousTo);
      const prevPlatformFiltered = filterByPlatform(allPreviousEvents, platform);
      previousEvents = filterByUserType(prevPlatformFiltered, userType);
    } catch {
      // Use empty array if previous period data unavailable
    }

    const prevMarketing = filterEventsByType(previousEvents, MARKETING_EVENTS);
    const prevCTAClicks = countEvents(prevMarketing, 'Try_For_Free_Clicked') + countEvents(prevMarketing, 'Create_Account_Clicked');
    const ctaClicksTrend = calculateTrend(totalCTAClicks, prevCTAClicks);
    const featurePagesTrend = calculateTrend(featurePagesVisited, countEvents(prevMarketing, 'Feature_Page_Visited'));
    const guestPromptsTrend = calculateTrend(guestSignupPrompts, countEvents(prevMarketing, 'Guest_Signup_Prompt'));
    const prevDismissals = countEvents(prevMarketing, 'Paywall_Dismissed') + countEvents(prevMarketing, 'Paywall Dismissed');
    const paywallDismissalsTrend = calculateTrend(paywallDismissals, prevDismissals);

    // CTA source distribution
    const tryFreeEvents = marketingEvents.filter((e) => e.event === 'Try_For_Free_Clicked');
    const createAccountEvents = marketingEvents.filter((e) => e.event === 'Create_Account_Clicked');
    const allCTAEvents = [...tryFreeEvents, ...createAccountEvents];
    const ctaSourceDist = getPropertyDistribution(allCTAEvents, 'source');
    const ctaSourceDistribution = Array.from(ctaSourceDist.entries())
      .map(([source, count]) => ({ source: source || 'Unknown', count }))
      .sort((a, b) => b.count - a.count);

    // Feature page distribution
    const featurePageEvents = marketingEvents.filter((e) => e.event === 'Feature_Page_Visited');
    const featurePageDist = getPropertyDistribution(featurePageEvents, 'page');
    const featurePageDistribution = Array.from(featurePageDist.entries())
      .map(([page, count]) => ({ page: page || 'Unknown', count }))
      .sort((a, b) => b.count - a.count);

    // Feature limit reached distribution
    const featureLimitEvents = marketingEvents.filter((e) => e.event === 'Feature_Limit_Reached');
    const featureLimitDist = getPropertyDistribution(featureLimitEvents, 'feature');
    const featureLimitDistribution = Array.from(featureLimitDist.entries())
      .map(([feature, count]) => ({ feature: feature || 'Unknown', count }))
      .sort((a, b) => b.count - a.count);

    // Guest signup prompt source distribution
    const guestPromptEvents = marketingEvents.filter((e) => e.event === 'Guest_Signup_Prompt');
    const guestPromptDist = getPropertyDistribution(guestPromptEvents, 'source');
    const guestPromptSourceDistribution = Array.from(guestPromptDist.entries())
      .map(([source, count]) => ({ source: source || 'Unknown', count }))
      .sort((a, b) => b.count - a.count);

    // Daily data
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = marketingEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      return {
        date,
        tryFree: dayEvents.filter((e) => e.event === 'Try_For_Free_Clicked').length,
        createAccount: dayEvents.filter((e) => e.event === 'Create_Account_Clicked').length,
        featurePages: dayEvents.filter((e) => e.event === 'Feature_Page_Visited').length,
        guestPrompts: dayEvents.filter((e) => e.event === 'Guest_Signup_Prompt').length,
      };
    });

    // ── Landing-page navigation metrics ───────────────────────────────────
    // Page views and first-time visitors read from `Page_Viewed` / `Marketing_Session_Started`,
    // which are NOT in MARKETING_EVENTS, so they come off the platform/user-filtered `events`.
    // Single pass builds: total page views, the per-page view/unique-visitor distribution, and
    // each visitor's first-seen timestamp (min over session + page-view events).
    const pageMap = new Map<string, { views: number; visitors: Set<string> }>();
    const firstSeen = new Map<string, number>();
    let pageViews = 0;
    for (const e of events) {
      const isPageView = e.event === 'Page_Viewed';
      if (isPageView) {
        pageViews += 1;
        const page = (e.properties.page_name as string) || 'Unknown';
        let entry = pageMap.get(page);
        if (!entry) {
          entry = { views: 0, visitors: new Set<string>() };
          pageMap.set(page, entry);
        }
        entry.views += 1;
        entry.visitors.add(e.properties.distinct_id);
      }
      if (isPageView || e.event === 'Marketing_Session_Started') {
        const id = e.properties.distinct_id;
        const t = e.properties.time;
        const prev = firstSeen.get(id);
        if (prev === undefined || t < prev) firstSeen.set(id, t);
      }
    }
    const pageViewDistribution = Array.from(pageMap.entries())
      .filter(([page]) => page !== 'Unknown')
      .map(([page, { views, visitors }]) => ({ page, views, visitors: visitors.size }))
      .sort((a, b) => b.views - a.views);

    // Single pass over the prior window: previous page-view count (trend) and the
    // "seen before" baseline. previousEvents is [] when that fetch failed, in which case
    // every current visitor reads as new — same caveat as the CTA/feature trends above.
    let prevPageViews = 0;
    const seenBefore = new Set<string>();
    for (const e of previousEvents) {
      if (e.event === 'Page_Viewed') prevPageViews += 1;
      if (e.event === 'Page_Viewed' || e.event === 'Marketing_Session_Started') {
        seenBefore.add(e.properties.distinct_id);
      }
    }

    // Pages per session — denominator is the 30-min-deduped Marketing_Session_Started count.
    const pagesPerSession = Math.round(safeDiv(pageViews, marketingSessions) * 10) / 10;
    const pageViewsTrend = calculateTrend(pageViews, prevPageViews);

    // First-time visitors: bucket each new distinct_id by its first-seen day. Building from
    // firstSeen (not a per-day re-filter) keeps sum(newVisitorsDaily) === newVisitors.
    const newVisitorDays = new Map<string, number>();
    let newVisitors = 0;
    for (const [id, t] of firstSeen) {
      if (seenBefore.has(id)) continue;
      newVisitors += 1;
      const date = formatDate(new Date(t * 1000));
      newVisitorDays.set(date, (newVisitorDays.get(date) || 0) + 1);
    }
    const newVisitorsDaily = days.map((date) => ({
      date,
      newVisitors: newVisitorDays.get(date) || 0,
    }));

    // Where do visitors come from? Referrer host + UTM tags on the first session of each visit.
    const sessionStartEvents = marketingEvents.filter((e) => e.event === 'Marketing_Session_Started');
    const referrerCounts = new Map<string, number>();
    for (const e of sessionStartEvents) {
      const host = referrerHost(e.properties.referrer);
      referrerCounts.set(host, (referrerCounts.get(host) || 0) + 1);
    }
    const referrerDistribution = toSourceList(referrerCounts);
    const utmSourceDistribution = distributionByProp(sessionStartEvents, 'utm_source');
    const utmMediumDistribution = distributionByProp(sessionStartEvents, 'utm_medium');
    const utmCampaignDistribution = distributionByProp(sessionStartEvents, 'utm_campaign');

    // Marketing CTA funnel: Page View → CTA Click → Signup Prompt → Feature Limit
    const funnelTop = marketingSessions || 1;
    const marketingCTAFunnel = [
      { name: 'Marketing Sessions', count: marketingSessions, percentage: 100, dropoff: 0 },
      {
        name: 'CTA Clicked',
        count: totalCTAClicks,
        percentage: Math.round((totalCTAClicks / funnelTop) * 100 * 10) / 10,
        dropoff: marketingSessions > 0 ? Math.round(Math.max(0, ((marketingSessions - totalCTAClicks) / marketingSessions) * 100) * 10) / 10 : 0,
      },
      {
        name: 'Feature Pages Visited',
        count: featurePagesVisited,
        percentage: Math.round((featurePagesVisited / funnelTop) * 100 * 10) / 10,
        dropoff: totalCTAClicks > 0 ? Math.round(Math.max(0, ((totalCTAClicks - featurePagesVisited) / totalCTAClicks) * 100) * 10) / 10 : 0,
      },
      {
        name: 'Guest Signup Prompts',
        count: guestSignupPrompts,
        percentage: Math.round((guestSignupPrompts / funnelTop) * 100 * 10) / 10,
        dropoff: featurePagesVisited > 0 ? Math.round(Math.max(0, ((featurePagesVisited - guestSignupPrompts) / featurePagesVisited) * 100) * 10) / 10 : 0,
      },
    ];

    const response = NextResponse.json({
      totalCTAClicks,
      tryForFreeClicks,
      createAccountClicks,
      featurePagesVisited,
      guestSignupPrompts,
      paywallDismissals,
      featureLimitReached,
      marketingSessions,
      pageViews,
      pagesPerSession,
      newVisitors,
      ctaClicksTrend,
      featurePagesTrend,
      guestPromptsTrend,
      paywallDismissalsTrend,
      pageViewsTrend,
      ctaSourceDistribution,
      featurePageDistribution,
      featureLimitDistribution,
      guestPromptSourceDistribution,
      pageViewDistribution,
      referrerDistribution,
      utmSourceDistribution,
      utmMediumDistribution,
      utmCampaignDistribution,
      dailyData,
      newVisitorsDaily,
      marketingCTAFunnel,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching marketing metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch marketing metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
