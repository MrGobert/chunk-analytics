import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';

// ---------- Platform detection ----------

type PlatformGroup = 'web' | 'ios' | 'macOS';

function getPlatformGroup(e: MixpanelEvent): PlatformGroup | null {
  const props = e.properties;
  const os = (props.$os as string) || '';
  const mpLib = (props.mp_lib as string) || '';
  const platform = (props.platform as string) || '';

  if (mpLib === 'web' || platform === 'web') return 'web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iOS' || os === 'iPadOS' || os === 'visionOS' ||
      platform === 'iOS' || platform === 'visionOS') return 'ios';
  return null;
}

// ---------- Helpers ----------

const SIGNUP_EVENTS = ['SignUp', 'Signup_Completed', 'Account Created'];
const PURCHASE_EVENTS = ['Purchase Completed', 'Purchase_Completed'];
const ONBOARDING_START_EVENTS = ['Onboarding_Viewed', 'onboarding_v2_started'];
const ONBOARDING_COMPLETE_EVENTS = ['Onboarding_Completed', 'onboarding_v2_completed'];

function uniqueUsersFor(events: MixpanelEvent[], eventNames: string[]): Set<string> {
  return new Set(
    events
      .filter((e) => eventNames.includes(e.event))
      .map((e) => e.properties.distinct_id)
  );
}

/**
 * Build funnel with correct percentage math.
 * Percentages are relative to the FIRST step.
 * When the first step count is 0, all percentages are 0 — NOT 100%.
 */
function buildFunnel(steps: { name: string; count: number }[]) {
  const base = steps[0]?.count ?? 0;
  return steps.map((step, i) => {
    const prevCount = i > 0 ? steps[i - 1].count : step.count;
    return {
      name: step.name,
      count: step.count,
      percentage: base > 0
        ? Math.round((step.count / base) * 1000) / 10
        : 0,
      dropoff: i === 0
        ? 0
        : prevCount > 0
          ? Math.round(((prevCount - step.count) / prevCount) * 1000) / 10
          : 0,
    };
  });
}

/** Safe division returning 0–1 range. Returns 0 when denominator is 0. */
function safeDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

// ---------- Platform-specific funnel builders ----------

function buildWebFunnel(events: MixpanelEvent[]) {
  const marketingUsers = uniqueUsersFor(events, ['Marketing_Session_Started']);
  const ctaUsers = uniqueUsersFor(events, ['Try_For_Free_Clicked', 'Create_Account_Clicked']);
  const guestUsers = new Set(
    events
      .filter(
        (e) =>
          e.event === 'Guest_Activity' ||
          (e.event === 'App_Session_Started' && e.properties.user_type === 'guest')
      )
      .map((e) => e.properties.distinct_id)
  );
  const signupUsers = uniqueUsersFor(events, SIGNUP_EVENTS);
  const subscriberUsers = uniqueUsersFor(events, PURCHASE_EVENTS);

  const steps = [
    { name: 'Marketing Visit', count: marketingUsers.size },
    { name: 'CTA Clicked', count: ctaUsers.size },
    { name: 'Guest Trial', count: guestUsers.size },
    { name: 'Signed Up', count: signupUsers.size },
    { name: 'Subscribed', count: subscriberUsers.size },
  ];

  return {
    funnel: buildFunnel(steps),
    conversionRates: {
      marketingToCTA: safeDiv(ctaUsers.size, marketingUsers.size),
      ctaToGuest: safeDiv(guestUsers.size, ctaUsers.size),
      guestToSignup: safeDiv(signupUsers.size, guestUsers.size),
      signupToSubscriber: safeDiv(subscriberUsers.size, signupUsers.size),
      overall: safeDiv(subscriberUsers.size, marketingUsers.size),
    },
    statCards: [
      { label: 'Marketing → CTA', value: safeDiv(ctaUsers.size, marketingUsers.size) },
      { label: 'CTA → Guest', value: safeDiv(guestUsers.size, ctaUsers.size) },
      { label: 'Guest → Signup', value: safeDiv(signupUsers.size, guestUsers.size) },
      { label: 'Signup → Subscriber', value: safeDiv(subscriberUsers.size, signupUsers.size) },
    ],
    dailyKeys: ['marketing', 'cta', 'guest', 'signup', 'subscriber'] as const,
    dailyLabels: {
      marketing: 'Marketing Visit',
      cta: 'CTA Clicked',
      guest: 'Guest Trial',
      signup: 'Signed Up',
      subscriber: 'Subscribed',
    },
    _sets: { marketingUsers, ctaUsers, guestUsers, signupUsers, subscriberUsers },
  };
}

function buildIOSFunnel(events: MixpanelEvent[]) {
  const onboardingStarted = uniqueUsersFor(events, ONBOARDING_START_EVENTS);
  const onboardingCompleted = uniqueUsersFor(events, ONBOARDING_COMPLETE_EVENTS);
  const signupUsers = uniqueUsersFor(events, SIGNUP_EVENTS);
  const subscriberUsers = uniqueUsersFor(events, PURCHASE_EVENTS);

  const steps = [
    { name: 'Onboarding Started', count: onboardingStarted.size },
    { name: 'Onboarding Completed', count: onboardingCompleted.size },
    { name: 'Account Created', count: signupUsers.size },
    { name: 'Subscribed', count: subscriberUsers.size },
  ];

  return {
    funnel: buildFunnel(steps),
    conversionRates: {
      onboardingStartToComplete: safeDiv(onboardingCompleted.size, onboardingStarted.size),
      onboardingToSignup: safeDiv(signupUsers.size, onboardingCompleted.size),
      signupToSubscriber: safeDiv(subscriberUsers.size, signupUsers.size),
      overall: safeDiv(subscriberUsers.size, onboardingStarted.size),
    },
    statCards: [
      { label: 'Onboarding Completion', value: safeDiv(onboardingCompleted.size, onboardingStarted.size) },
      { label: 'Onboarding → Signup', value: safeDiv(signupUsers.size, onboardingCompleted.size) },
      { label: 'Signup → Subscriber', value: safeDiv(subscriberUsers.size, signupUsers.size) },
      { label: 'Overall Conversion', value: safeDiv(subscriberUsers.size, onboardingStarted.size) },
    ],
    dailyKeys: ['onboardingStarted', 'onboardingCompleted', 'signup', 'subscriber'] as const,
    dailyLabels: {
      onboardingStarted: 'Onboarding Started',
      onboardingCompleted: 'Onboarding Completed',
      signup: 'Account Created',
      subscriber: 'Subscribed',
    },
    _sets: { onboardingStarted, onboardingCompleted, signupUsers, subscriberUsers },
  };
}

function buildMacOSFunnel(events: MixpanelEvent[]) {
  // Top of funnel: all unique macOS users (any event = launched the app)
  const appUsers = new Set(events.map((e) => e.properties.distinct_id));
  const signupUsers = uniqueUsersFor(events, [...SIGNUP_EVENTS, 'Login_Completed']);
  const paywallUsers = uniqueUsersFor(events, ['Paywall_Viewed']);
  const subscriberUsers = uniqueUsersFor(events, PURCHASE_EVENTS);

  const steps = [
    { name: 'App Users', count: appUsers.size },
    { name: 'Signed Up / Logged In', count: signupUsers.size },
    { name: 'Paywall Viewed', count: paywallUsers.size },
    { name: 'Subscribed', count: subscriberUsers.size },
  ];

  return {
    funnel: buildFunnel(steps),
    conversionRates: {
      appToSignup: safeDiv(signupUsers.size, appUsers.size),
      signupToPaywall: safeDiv(paywallUsers.size, signupUsers.size),
      paywallToSubscriber: safeDiv(subscriberUsers.size, paywallUsers.size),
      overall: safeDiv(subscriberUsers.size, appUsers.size),
    },
    statCards: [
      { label: 'App → Signup', value: safeDiv(signupUsers.size, appUsers.size) },
      { label: 'Signup → Paywall', value: safeDiv(paywallUsers.size, signupUsers.size) },
      { label: 'Paywall → Subscriber', value: safeDiv(subscriberUsers.size, paywallUsers.size) },
      { label: 'Overall Conversion', value: safeDiv(subscriberUsers.size, appUsers.size) },
    ],
    dailyKeys: ['appUsers', 'signup', 'paywall', 'subscriber'] as const,
    dailyLabels: {
      appUsers: 'App Users',
      signup: 'Signed Up / Logged In',
      paywall: 'Paywall Viewed',
      subscriber: 'Subscribed',
    },
    _sets: { appUsers, signupUsers, paywallUsers, subscriberUsers },
  };
}

// ---------- Daily data builder ----------

type DailyEventMatcher = {
  key: string;
  match: (e: MixpanelEvent) => boolean;
};

function buildDailyData(
  events: MixpanelEvent[],
  days: string[],
  matchers: DailyEventMatcher[],
) {
  return days.map((date) => {
    const dayEvents = events.filter((e) => {
      const eventDate = formatDate(new Date(e.properties.time * 1000));
      return eventDate === date;
    });

    const row: Record<string, string | number> = { date };
    for (const m of matchers) {
      row[m.key] = new Set(
        dayEvents.filter(m.match).map((e) => e.properties.distinct_id)
      ).size;
    }
    return row;
  });
}

// ---------- GET handler ----------

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platformParam = (searchParams.get('platform') || 'web') as PlatformGroup;
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const userFiltered = filterByUserType(allEvents, userType);

    // Filter to selected platform
    const events = userFiltered.filter((e) => getPlatformGroup(e) === platformParam);
    const days = getDaysInRange(dateRange.from, dateRange.to);

    let funnel: ReturnType<typeof buildFunnel>;
    let conversionRates: Record<string, number>;
    let statCards: { label: string; value: number }[];
    let dailyData: Record<string, string | number>[];
    let dailyLines: { key: string; color: string; name: string }[];
    let subtitle: string;

    if (platformParam === 'web') {
      const result = buildWebFunnel(events);
      funnel = result.funnel;
      conversionRates = result.conversionRates;
      statCards = result.statCards;
      subtitle = 'Marketing site → guest trial → signup → subscription';

      dailyData = buildDailyData(events, days, [
        { key: 'marketing', match: (e) => e.event === 'Marketing_Session_Started' },
        { key: 'cta', match: (e) => e.event === 'Try_For_Free_Clicked' || e.event === 'Create_Account_Clicked' },
        { key: 'guest', match: (e) => e.event === 'Guest_Activity' || (e.event === 'App_Session_Started' && e.properties.user_type === 'guest') },
        { key: 'signup', match: (e) => SIGNUP_EVENTS.includes(e.event) },
        { key: 'subscriber', match: (e) => PURCHASE_EVENTS.includes(e.event) },
      ]);
      dailyLines = [
        { key: 'marketing', color: '#f59e0b', name: 'Marketing Visit' },
        { key: 'cta', color: '#ec4899', name: 'CTA Clicked' },
        { key: 'guest', color: '#8b5cf6', name: 'Guest Trial' },
        { key: 'signup', color: '#3b82f6', name: 'Signed Up' },
        { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
      ];

    } else if (platformParam === 'ios') {
      const result = buildIOSFunnel(events);
      funnel = result.funnel;
      conversionRates = result.conversionRates;
      statCards = result.statCards;
      subtitle = 'Onboarding → account creation → subscription';

      dailyData = buildDailyData(events, days, [
        { key: 'onboardingStarted', match: (e) => ONBOARDING_START_EVENTS.includes(e.event) },
        { key: 'onboardingCompleted', match: (e) => ONBOARDING_COMPLETE_EVENTS.includes(e.event) },
        { key: 'signup', match: (e) => SIGNUP_EVENTS.includes(e.event) },
        { key: 'subscriber', match: (e) => PURCHASE_EVENTS.includes(e.event) },
      ]);
      dailyLines = [
        { key: 'onboardingStarted', color: '#f59e0b', name: 'Onboarding Started' },
        { key: 'onboardingCompleted', color: '#8b5cf6', name: 'Onboarding Completed' },
        { key: 'signup', color: '#3b82f6', name: 'Account Created' },
        { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
      ];

    } else {
      // macOS
      const result = buildMacOSFunnel(events);
      funnel = result.funnel;
      conversionRates = result.conversionRates;
      statCards = result.statCards;
      subtitle = 'App launch → signup → paywall → subscription (no onboarding)';

      dailyData = buildDailyData(events, days, [
        { key: 'appUsers', match: () => true }, // any event = active user
        { key: 'signup', match: (e) => [...SIGNUP_EVENTS, 'Login_Completed'].includes(e.event) },
        { key: 'paywall', match: (e) => e.event === 'Paywall_Viewed' },
        { key: 'subscriber', match: (e) => PURCHASE_EVENTS.includes(e.event) },
      ]);
      dailyLines = [
        { key: 'appUsers', color: '#f59e0b', name: 'App Users' },
        { key: 'signup', color: '#8b5cf6', name: 'Signed Up / Logged In' },
        { key: 'paywall', color: '#3b82f6', name: 'Paywall Viewed' },
        { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
      ];
    }

    return NextResponse.json(
      {
        platform: platformParam,
        subtitle,
        funnel,
        conversionRates,
        statCards,
        dailyData,
        dailyLines,
        lastUpdated: getLastUpdated(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching acquisition metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch acquisition metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
