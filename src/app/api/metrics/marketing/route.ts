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
import { buildFunnel } from '@/lib/funnel';
import {
  marketingCtaClicks,
  marketingFeatureKey,
  marketingFeaturePageVisits,
  marketingJourneyId,
  marketingPageLabel,
  marketingPageViews,
  orderedJourneyCounts,
  signupCompletions,
} from '@/lib/marketing-events';

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
  'Marketing_CTA_Clicked',
  'Try_For_Free_Clicked',
  'Create_Account_Clicked',
  'Feature_Page_Visited',
  'Guest_Signup_Prompt',
  'Feature_Limit_Reached',
  'Paywall_Dismissed',
  'Paywall Dismissed',
  'Marketing_Session_Started',
  'Signup_Started',
  'Signup_Completed',
  'SignUp',
  'Account Created',
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

    // Canonical events are dual-written with their legacy equivalents during
    // the migration. Collapse each pair one-to-one, retaining historical
    // legacy-only rows and any genuine repeated actions.
    const ctaEvents = marketingCtaClicks(events);
    const pageViewEvents = marketingPageViews(events);
    const featurePageEvents = marketingFeaturePageVisits(events);
    const signupStartEvents = events.filter((event) => event.event === 'Signup_Started');
    const signupCompleteEvents = signupCompletions(events);

    // Summary counts
    const tryForFreeClicks = ctaEvents.filter(
      (event) => event.event === 'Try_For_Free_Clicked',
    ).length;
    const totalCTAClicks = ctaEvents.length;
    const createAccountClicks = totalCTAClicks - tryForFreeClicks;
    const featurePagesVisited = featurePageEvents.length;
    const guestSignupPrompts = countEvents(marketingEvents, 'Guest_Signup_Prompt');
    const paywallDismissals = countEvents(marketingEvents, 'Paywall_Dismissed') + countEvents(marketingEvents, 'Paywall Dismissed');
    const featureLimitReached = countEvents(marketingEvents, 'Feature_Limit_Reached');
    const marketingSessions = countEvents(marketingEvents, 'Marketing_Session_Started');
    const signupStarts = signupStartEvents.length;
    const signupCompletionsCount = signupCompleteEvents.length;

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
    const previousCtaEvents = marketingCtaClicks(previousEvents);
    const previousPageViewEvents = marketingPageViews(previousEvents);
    const previousFeaturePageEvents = marketingFeaturePageVisits(previousEvents);
    const previousSignupStarts = previousEvents.filter(
      (event) => event.event === 'Signup_Started',
    );
    const previousSignupCompletions = signupCompletions(previousEvents);
    const prevCTAClicks = previousCtaEvents.length;
    const ctaClicksTrend = calculateTrend(totalCTAClicks, prevCTAClicks);
    const signupStartsTrend = calculateTrend(signupStarts, previousSignupStarts.length);
    const signupCompletionsTrend = calculateTrend(
      signupCompletionsCount,
      previousSignupCompletions.length,
    );
    const featurePagesTrend = calculateTrend(
      featurePagesVisited,
      previousFeaturePageEvents.length,
    );
    const guestPromptsTrend = calculateTrend(guestSignupPrompts, countEvents(prevMarketing, 'Guest_Signup_Prompt'));
    const prevDismissals = countEvents(prevMarketing, 'Paywall_Dismissed') + countEvents(prevMarketing, 'Paywall Dismissed');
    const paywallDismissalsTrend = calculateTrend(paywallDismissals, prevDismissals);

    // CTA source distribution
    const ctaSourceCounts = new Map<string, number>();
    for (const event of ctaEvents) {
      const source =
        (event.properties.cta_id as string | undefined) ||
        (event.properties.source as string | undefined) ||
        (event.properties.placement as string | undefined) ||
        'Unknown';
      ctaSourceCounts.set(source, (ctaSourceCounts.get(source) || 0) + 1);
    }
    const ctaSourceDistribution = Array.from(ctaSourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // Feature page distribution
    const featurePageCounts = new Map<string, number>();
    for (const event of featurePageEvents) {
      const feature = marketingFeatureKey(event);
      featurePageCounts.set(feature, (featurePageCounts.get(feature) || 0) + 1);
    }
    const featurePageDistribution = Array.from(featurePageCounts.entries())
      .map(([page, count]) => ({ page, count }))
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
      const dayMarketingEvents = marketingEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });
      const dayCtaEvents = ctaEvents.filter(
        (event) => formatDate(new Date(event.properties.time * 1000)) === date,
      );
      const daySignupStarts = signupStartEvents.filter(
        (event) => formatDate(new Date(event.properties.time * 1000)) === date,
      );
      const daySignupCompletions = signupCompleteEvents.filter(
        (event) => formatDate(new Date(event.properties.time * 1000)) === date,
      );
      const dayTryFree = dayCtaEvents.filter(
        (event) => event.event === 'Try_For_Free_Clicked',
      ).length;

      return {
        date,
        tryFree: dayTryFree,
        createAccount: dayCtaEvents.length - dayTryFree,
        ctaClicks: dayCtaEvents.length,
        signupStarts: daySignupStarts.length,
        signupCompletions: daySignupCompletions.length,
        featurePages: featurePageEvents.filter(
          (event) => formatDate(new Date(event.properties.time * 1000)) === date,
        ).length,
        guestPrompts: dayMarketingEvents.filter((e) => e.event === 'Guest_Signup_Prompt').length,
      };
    });

    // ── Landing-page navigation metrics ───────────────────────────────────
    // Page views prefer the canonical event and fall back to legacy-only data.
    const pageMap = new Map<string, { views: number; visitors: Set<string> }>();
    const firstSeen = new Map<string, number>();
    const pageViews = pageViewEvents.length;
    for (const event of pageViewEvents) {
      const page = marketingPageLabel(event);
      let entry = pageMap.get(page);
      if (!entry) {
        entry = { views: 0, visitors: new Set<string>() };
        pageMap.set(page, entry);
      }
      entry.views += 1;
      entry.visitors.add(marketingJourneyId(event));
    }
    for (const event of [
      ...pageViewEvents,
      ...events.filter((item) => item.event === 'Marketing_Session_Started'),
    ]) {
      const id = marketingJourneyId(event);
      const t = event.properties.time;
      const prev = firstSeen.get(id);
      if (prev === undefined || t < prev) {
        firstSeen.set(id, t);
      }
    }
    const pageViewDistribution = Array.from(pageMap.entries())
      .filter(([page]) => page !== 'Unknown')
      .map(([page, { views, visitors }]) => ({ page, views, visitors: visitors.size }))
      .sort((a, b) => b.views - a.views);

    // Single pass over the prior window: previous page-view count (trend) and the
    // "seen before" baseline. previousEvents is [] when that fetch failed, in which case
    // every current visitor reads as new — same caveat as the CTA/feature trends above.
    const prevPageViews = previousPageViewEvents.length;
    const seenBefore = new Set<string>();
    for (const event of [
      ...previousPageViewEvents,
      ...previousEvents.filter((item) => item.event === 'Marketing_Session_Started'),
    ]) {
      seenBefore.add(marketingJourneyId(event));
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
      const host = referrerHost(
        e.properties.referrer_domain ?? e.properties.referrer ?? e.properties.$referrer,
      );
      referrerCounts.set(host, (referrerCounts.get(host) || 0) + 1);
    }
    const referrerDistribution = toSourceList(referrerCounts);
    const utmSourceDistribution = distributionByProp(sessionStartEvents, 'utm_source');
    const utmMediumDistribution = distributionByProp(sessionStartEvents, 'utm_medium');
    const utmCampaignDistribution = distributionByProp(sessionStartEvents, 'utm_campaign');

    // Require each later stage to belong to a visitor who reached the previous
    // stage. $device_id keeps the journey connected after Mixpanel identify().
    const marketingCTAFunnel = buildFunnel(
      orderedJourneyCounts([
        {
          name: 'Marketing Visitors',
          events: [...sessionStartEvents, ...pageViewEvents],
        },
        { name: 'CTA Clicked', events: ctaEvents },
        { name: 'Signup Started', events: signupStartEvents },
        { name: 'Signup Completed', events: signupCompleteEvents },
      ]),
    );

    const response = NextResponse.json({
      totalCTAClicks,
      tryForFreeClicks,
      createAccountClicks,
      featurePagesVisited,
      guestSignupPrompts,
      paywallDismissals,
      featureLimitReached,
      marketingSessions,
      signupStarts,
      signupCompletions: signupCompletionsCount,
      pageViews,
      pagesPerSession,
      newVisitors,
      ctaClicksTrend,
      signupStartsTrend,
      signupCompletionsTrend,
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
