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
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

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
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
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
      ctaClicksTrend,
      featurePagesTrend,
      guestPromptsTrend,
      paywallDismissalsTrend,
      ctaSourceDistribution,
      featurePageDistribution,
      featureLimitDistribution,
      guestPromptSourceDistribution,
      dailyData,
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
