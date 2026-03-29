import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';

// Required for Vercel — without this the function times out at 10s
// while waiting for the Mixpanel export API (can take 15-30s on cache miss)
export const maxDuration = 60;

// ---------- Platform detection ----------

type PlatformGroup = 'web' | 'ios' | 'macOS';

function getPlatformGroup(e: MixpanelEvent): PlatformGroup | null {
  const props = e.properties;
  const os = (props.$os as string) || '';
  const mpLib = (props.mp_lib as string) || '';
  const platform = (props.platform as string) || '';

  if (mpLib === 'web' || platform === 'web') return 'web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (
    os === 'iOS' ||
    os === 'iPadOS' ||
    os === 'visionOS' ||
    platform === 'iOS' ||
    platform === 'visionOS'
  )
    return 'ios';
  return null;
}

// ---------- Helpers ----------

const SIGNUP_EVENTS = ['SignUp', 'Signup_Completed', 'Account Created'];
const PURCHASE_EVENTS = ['Purchase Completed', 'Purchase_Completed'];
const ONBOARDING_START_EVENTS = [
  'Onboarding_Viewed',
  'onboarding_v2_started',
];
const ONBOARDING_COMPLETE_EVENTS = [
  'Onboarding_Completed',
  'onboarding_v2_completed',
];

// Web first-run onboarding events
const WEB_ONBOARDING_START_EVENTS = ['First_Run_Onboarding_Started'];
const WEB_ONBOARDING_COMPLETE_EVENTS = ['First_Run_Onboarding_Completed'];
const WEB_ONBOARDING_SKIP_EVENTS = ['First_Run_Onboarding_Skipped'];
const WEB_ONBOARDING_INTENT_EVENTS = ['First_Run_Onboarding_Intent_Selected'];

function uniqueUsersFor(
  events: MixpanelEvent[],
  eventNames: string[],
): Set<string> {
  return new Set(
    events
      .filter((e) => eventNames.includes(e.event))
      .map((e) => e.properties.distinct_id),
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
      dropoff:
        i === 0
          ? 0
          : prevCount > 0
            ? Math.round(
                ((prevCount - step.count) / prevCount) * 1000,
              ) / 10
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
  const marketingUsers = uniqueUsersFor(events, [
    'Marketing_Session_Started',
  ]);
  const ctaUsers = uniqueUsersFor(events, [
    'Try_For_Free_Clicked',
    'Create_Account_Clicked',
  ]);
  const guestUsers = new Set(
    events
      .filter(
        (e) =>
          e.event === 'Guest_Activity' ||
          (e.event === 'App_Session_Started' &&
            e.properties.user_type === 'guest'),
      )
      .map((e) => e.properties.distinct_id),
  );
  const signupUsers = uniqueUsersFor(events, SIGNUP_EVENTS);
  const onboardingStartedUsers = uniqueUsersFor(events, WEB_ONBOARDING_START_EVENTS);
  const onboardingCompletedUsers = uniqueUsersFor(events, WEB_ONBOARDING_COMPLETE_EVENTS);
  const subscriberUsers = uniqueUsersFor(events, PURCHASE_EVENTS);

  const steps = [
    { name: 'Marketing Visit', count: marketingUsers.size },
    { name: 'CTA Clicked', count: ctaUsers.size },
    { name: 'Guest Trial', count: guestUsers.size },
    { name: 'Signed Up', count: signupUsers.size },
    { name: 'Onboarding Started', count: onboardingStartedUsers.size },
    { name: 'Onboarding Completed', count: onboardingCompletedUsers.size },
    { name: 'Subscribed', count: subscriberUsers.size },
  ];

  return {
    funnel: buildFunnel(steps),
    statCards: [
      {
        label: 'Marketing → CTA',
        value: safeDiv(ctaUsers.size, marketingUsers.size),
      },
      {
        label: 'Guest → Signup',
        value: safeDiv(signupUsers.size, guestUsers.size),
      },
      {
        label: 'Onboarding Completion',
        value: safeDiv(onboardingCompletedUsers.size, onboardingStartedUsers.size),
      },
      {
        label: 'Signup → Subscriber',
        value: safeDiv(subscriberUsers.size, signupUsers.size),
      },
    ],
  };
}

/** Build web onboarding breakdown: intent distribution, skip rate, avg time */
function buildWebOnboardingMetrics(events: MixpanelEvent[]) {
  const started = events.filter((e) => WEB_ONBOARDING_START_EVENTS.includes(e.event));
  const completed = events.filter((e) => WEB_ONBOARDING_COMPLETE_EVENTS.includes(e.event));
  const skipped = events.filter((e) => WEB_ONBOARDING_SKIP_EVENTS.includes(e.event));
  const intentEvents = events.filter((e) => WEB_ONBOARDING_INTENT_EVENTS.includes(e.event));

  const startedCount = new Set(started.map((e) => e.properties.distinct_id)).size;
  const completedCount = new Set(completed.map((e) => e.properties.distinct_id)).size;
  const skippedCount = new Set(skipped.map((e) => e.properties.distinct_id)).size;

  // Intent distribution
  const intentCounts: Record<string, number> = {};
  const seenUsers = new Set<string>();
  for (const e of intentEvents) {
    const uid = e.properties.distinct_id;
    if (seenUsers.has(uid)) continue; // count each user once
    seenUsers.add(uid);
    const intent = (e.properties.intent as string) || 'unknown';
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
  }
  const intentDistribution = Object.entries(intentCounts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  // Average time to complete (seconds)
  const completionTimes = completed
    .map((e) => e.properties.time_to_complete_seconds as number)
    .filter((t) => typeof t === 'number' && t > 0);
  const avgCompletionTime = completionTimes.length > 0
    ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
    : null;

  // Skip step distribution
  const skipStepCounts: Record<string, number> = {};
  for (const e of skipped) {
    const step = String(e.properties.step ?? 'unknown');
    skipStepCounts[step] = (skipStepCounts[step] || 0) + 1;
  }
  const skipStepDistribution = Object.entries(skipStepCounts)
    .map(([step, count]) => {
      const stepLabels: Record<string, string> = {
        '0': 'Welcome',
        '1': 'Guided Action',
        '2': 'Aha Moment',
        '3': 'Feature Overview',
      };
      return { step: stepLabels[step] || `Step ${step}`, count };
    })
    .sort((a, b) => b.count - a.count);

  return {
    started: startedCount,
    completed: completedCount,
    skipped: skippedCount,
    completionRate: safeDiv(completedCount, startedCount),
    skipRate: safeDiv(skippedCount, startedCount),
    avgCompletionTime,
    intentDistribution,
    skipStepDistribution,
  };
}

function buildIOSFunnel(events: MixpanelEvent[]) {
  const onboardingStarted = uniqueUsersFor(
    events,
    ONBOARDING_START_EVENTS,
  );
  const onboardingCompleted = uniqueUsersFor(
    events,
    ONBOARDING_COMPLETE_EVENTS,
  );
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
    statCards: [
      {
        label: 'Onboarding Completion',
        value: safeDiv(onboardingCompleted.size, onboardingStarted.size),
      },
      {
        label: 'Onboarding → Signup',
        value: safeDiv(signupUsers.size, onboardingCompleted.size),
      },
      {
        label: 'Signup → Subscriber',
        value: safeDiv(subscriberUsers.size, signupUsers.size),
      },
      {
        label: 'Overall Conversion',
        value: safeDiv(subscriberUsers.size, onboardingStarted.size),
      },
    ],
  };
}

function buildMacOSFunnel(events: MixpanelEvent[]) {
  // Top of funnel: all unique macOS users (any event = launched the app)
  const appUsers = new Set(
    events.map((e) => e.properties.distinct_id),
  );
  const signupUsers = uniqueUsersFor(events, [
    ...SIGNUP_EVENTS,
    'Login_Completed',
  ]);
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
    statCards: [
      {
        label: 'App → Signup',
        value: safeDiv(signupUsers.size, appUsers.size),
      },
      {
        label: 'Signup → Paywall',
        value: safeDiv(paywallUsers.size, signupUsers.size),
      },
      {
        label: 'Paywall → Subscriber',
        value: safeDiv(subscriberUsers.size, paywallUsers.size),
      },
      {
        label: 'Overall Conversion',
        value: safeDiv(subscriberUsers.size, appUsers.size),
      },
    ],
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
        dayEvents.filter(m.match).map((e) => e.properties.distinct_id),
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
    const rawPlatform = searchParams.get('platform') || 'web';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    // Normalise platform — treat 'all' or unknown values as 'web' (safe default)
    const platformParam: PlatformGroup =
      rawPlatform === 'ios' || rawPlatform === 'macOS'
        ? rawPlatform
        : 'web';

    const dateRange =
      from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(
      dateRange.from,
      dateRange.to,
    );
    const userFiltered = filterByUserType(allEvents, userType);

    // Filter to selected platform
    const events = userFiltered.filter(
      (e) => getPlatformGroup(e) === platformParam,
    );
    const days = getDaysInRange(dateRange.from, dateRange.to);

    let funnel: ReturnType<typeof buildFunnel>;
    let statCards: { label: string; value: number }[];
    let dailyData: Record<string, string | number>[];
    let dailyLines: { key: string; color: string; name: string }[];
    let subtitle: string;

    // Build web onboarding metrics (returned for web platform only)
    let webOnboarding = null;

    if (platformParam === 'web') {
      const result = buildWebFunnel(events);
      funnel = result.funnel;
      statCards = result.statCards;
      subtitle =
        'Marketing site → guest trial → signup → onboarding → subscription';
      webOnboarding = buildWebOnboardingMetrics(events);

      dailyData = buildDailyData(events, days, [
        {
          key: 'marketing',
          match: (e) => e.event === 'Marketing_Session_Started',
        },
        {
          key: 'cta',
          match: (e) =>
            e.event === 'Try_For_Free_Clicked' ||
            e.event === 'Create_Account_Clicked',
        },
        {
          key: 'guest',
          match: (e) =>
            e.event === 'Guest_Activity' ||
            (e.event === 'App_Session_Started' &&
              e.properties.user_type === 'guest'),
        },
        {
          key: 'signup',
          match: (e) => SIGNUP_EVENTS.includes(e.event),
        },
        {
          key: 'onboardingStarted',
          match: (e) => WEB_ONBOARDING_START_EVENTS.includes(e.event),
        },
        {
          key: 'onboardingCompleted',
          match: (e) => WEB_ONBOARDING_COMPLETE_EVENTS.includes(e.event),
        },
        {
          key: 'subscriber',
          match: (e) => PURCHASE_EVENTS.includes(e.event),
        },
      ]);
      dailyLines = [
        { key: 'marketing', color: '#f59e0b', name: 'Marketing Visit' },
        { key: 'cta', color: '#ec4899', name: 'CTA Clicked' },
        { key: 'guest', color: '#8b5cf6', name: 'Guest Trial' },
        { key: 'signup', color: '#3b82f6', name: 'Signed Up' },
        { key: 'onboardingStarted', color: '#f97316', name: 'Onboarding Started' },
        { key: 'onboardingCompleted', color: '#14b8a6', name: 'Onboarding Completed' },
        { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
      ];
    } else if (platformParam === 'ios') {
      const result = buildIOSFunnel(events);
      funnel = result.funnel;
      statCards = result.statCards;
      subtitle = 'Onboarding → account creation → subscription';

      dailyData = buildDailyData(events, days, [
        {
          key: 'onboardingStarted',
          match: (e) => ONBOARDING_START_EVENTS.includes(e.event),
        },
        {
          key: 'onboardingCompleted',
          match: (e) =>
            ONBOARDING_COMPLETE_EVENTS.includes(e.event),
        },
        {
          key: 'signup',
          match: (e) => SIGNUP_EVENTS.includes(e.event),
        },
        {
          key: 'subscriber',
          match: (e) => PURCHASE_EVENTS.includes(e.event),
        },
      ]);
      dailyLines = [
        {
          key: 'onboardingStarted',
          color: '#f59e0b',
          name: 'Onboarding Started',
        },
        {
          key: 'onboardingCompleted',
          color: '#8b5cf6',
          name: 'Onboarding Completed',
        },
        { key: 'signup', color: '#3b82f6', name: 'Account Created' },
        {
          key: 'subscriber',
          color: '#10b981',
          name: 'Subscribed',
        },
      ];
    } else {
      // macOS
      const result = buildMacOSFunnel(events);
      funnel = result.funnel;
      statCards = result.statCards;
      subtitle =
        'App launch → signup → paywall → subscription (no onboarding)';

      dailyData = buildDailyData(events, days, [
        { key: 'appUsers', match: () => true },
        {
          key: 'signup',
          match: (e) =>
            [...SIGNUP_EVENTS, 'Login_Completed'].includes(e.event),
        },
        {
          key: 'paywall',
          match: (e) => e.event === 'Paywall_Viewed',
        },
        {
          key: 'subscriber',
          match: (e) => PURCHASE_EVENTS.includes(e.event),
        },
      ]);
      dailyLines = [
        { key: 'appUsers', color: '#f59e0b', name: 'App Users' },
        {
          key: 'signup',
          color: '#8b5cf6',
          name: 'Signed Up / Logged In',
        },
        { key: 'paywall', color: '#3b82f6', name: 'Paywall Viewed' },
        {
          key: 'subscriber',
          color: '#10b981',
          name: 'Subscribed',
        },
      ];
    }

    return NextResponse.json(
      {
        platform: platformParam,
        subtitle,
        funnel,
        statCards,
        dailyData,
        dailyLines,
        ...(webOnboarding ? { webOnboarding } : {}),
        lastUpdated: getLastUpdated(),
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching acquisition metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch acquisition metrics',
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
