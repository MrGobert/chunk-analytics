import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate, safeDiv } from '@/lib/utils';
import { buildFunnel, uniqueUsersFor } from '@/lib/funnel';
import { MixpanelEvent } from '@/types/mixpanel';

export const maxDuration = 60;

type PlatformGroup = 'web' | 'iOS' | 'iPadOS' | 'macOS' | 'visionOS';

const SIGNUP_EVENTS = ['SignUp', 'Signup_Completed', 'Account Created'];
const PURCHASE_EVENTS = ['Purchase Completed', 'Purchase_Completed'];
const ONBOARDING_START_EVENTS = ['onboarding_v2_started'];
const ONBOARDING_COMPLETE_EVENTS = ['onboarding_v2_completed'];
const ONBOARDING_SCREEN_EVENT = 'onboarding_v2_screen_viewed';
const ONBOARDING_SKIP_EVENT = 'onboarding_v2_skipped';
const ONBOARDING_AUTH_EVENTS = ['onboarding_v2_authentication_completed', 'onboarding_v2_account_created'];
const FIRST_RUN_PAYWALL_SOURCE = 'automatic_first_query';

function getPlatformGroup(e: MixpanelEvent): PlatformGroup | null {
  const props = e.properties;
  const os = String(props.$os || '');
  const mpLib = String(props.mp_lib || '');
  const platform = String(props.platform || '');

  if (mpLib === 'web' || platform === 'web') return 'web';
  if (os === 'iPadOS') return 'iPadOS';
  if (os === 'visionOS' || platform === 'visionOS') return 'visionOS';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iOS' || platform === 'iOS') return 'iOS';
  return null;
}

function usersFor(events: MixpanelEvent[], predicate: (event: MixpanelEvent) => boolean): Set<string> {
  return new Set(events.filter(predicate).map((event) => event.properties.distinct_id));
}

function unionUsers(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => Array.from(set)));
}

function buildDailyData(
  events: MixpanelEvent[],
  days: string[],
  matchers: { key: string; match: (event: MixpanelEvent) => boolean }[],
) {
  return days.map((date) => {
    const dayEvents = events.filter(
      (event) => formatDate(new Date(event.properties.time * 1000)) === date,
    );
    const row: Record<string, string | number> = { date };
    for (const matcher of matchers) {
      row[matcher.key] = usersFor(dayEvents, matcher.match).size;
    }
    return row;
  });
}

function pageLabel(raw: string): string {
  return raw
    .replace(/^paper_/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildWebMetrics(events: MixpanelEvent[]) {
  const pageViews = events.filter((event) => event.event === 'Page_Viewed');
  const marketingVisitors = usersFor(pageViews, () => true);
  const signupUsers = uniqueUsersFor(events, SIGNUP_EVENTS);
  const subscriberUsers = uniqueUsersFor(events, PURCHASE_EVENTS);

  const visitCounts = new Map<string, number>();
  for (const event of pageViews) {
    const page = String(event.properties.page_name || 'Unknown');
    if (page !== 'Unknown') visitCounts.set(page, (visitCounts.get(page) || 0) + 1);
  }

  const signupUsersByPage = new Map<string, Set<string>>();
  const signupPageByUser = new Map<string, string>();
  for (const event of events.filter((item) => SIGNUP_EVENTS.includes(item.event))) {
    const page = String(event.properties.signup_source_page || '');
    if (!page) continue;
    const uid = event.properties.distinct_id;
    signupPageByUser.set(uid, page);
    if (!signupUsersByPage.has(page)) signupUsersByPage.set(page, new Set());
    signupUsersByPage.get(page)?.add(uid);
  }

  const subscriberUsersByPage = new Map<string, Set<string>>();
  for (const event of events.filter((item) => PURCHASE_EVENTS.includes(item.event))) {
    const uid = event.properties.distinct_id;
    const page = String(event.properties.signup_source_page || signupPageByUser.get(uid) || '');
    if (!page) continue;
    if (!subscriberUsersByPage.has(page)) subscriberUsersByPage.set(page, new Set());
    subscriberUsersByPage.get(page)?.add(uid);
  }

  const allPages = new Set([
    ...visitCounts.keys(),
    ...signupUsersByPage.keys(),
    ...subscriberUsersByPage.keys(),
  ]);
  const pageAttribution = Array.from(allPages)
    .map((page) => {
      const visits = visitCounts.get(page) || 0;
      const signups = signupUsersByPage.get(page)?.size || 0;
      return {
        page,
        visits,
        signups,
        subscriptions: subscriberUsersByPage.get(page)?.size || 0,
        signupRate: safeDiv(signups, visits),
      };
    })
    .sort((a, b) => b.signups - a.signups || b.visits - a.visits)
    .slice(0, 15);

  return {
    funnel: buildFunnel([
      { name: 'Marketing Visitors', count: marketingVisitors.size },
      { name: 'Account Created', count: signupUsers.size },
      { name: 'Subscribed', count: subscriberUsers.size },
    ]),
    statCards: [
      { label: 'Marketing Visitors', value: marketingVisitors.size, format: 'number' as const },
      { label: 'Accounts Created', value: signupUsers.size, format: 'number' as const },
      { label: 'Visitor → Signup', value: safeDiv(signupUsers.size, marketingVisitors.size), format: 'percentage' as const },
      { label: 'Signup → Subscriber', value: safeDiv(subscriberUsers.size, signupUsers.size), format: 'percentage' as const },
    ],
    topPages: Array.from(visitCounts)
      .map(([page, visits]) => ({ page, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 15),
    pageAttribution,
  };
}

function buildAppleMetrics(events: MixpanelEvent[]) {
  const onboardingEvents = events.filter(
    (event) => event.properties.onboarding_entry_mode !== 'returning_gate',
  );
  const started = uniqueUsersFor(onboardingEvents, ONBOARDING_START_EVENTS);
  const completed = uniqueUsersFor(onboardingEvents, ONBOARDING_COMPLETE_EVENTS);
  const screenEvents = onboardingEvents.filter((event) => {
    const screen = String(event.properties.screen || '');
    return event.event === ONBOARDING_SCREEN_EVENT && screen.startsWith('paper_');
  });

  const screenUsers = new Map<string, { index: number; users: Set<string> }>();
  for (const event of screenEvents) {
    const screen = String(event.properties.screen);
    const index = Number(event.properties.screen_index);
    if (!screenUsers.has(screen)) {
      screenUsers.set(screen, { index: Number.isFinite(index) ? index : 999, users: new Set() });
    }
    screenUsers.get(screen)?.users.add(event.properties.distinct_id);
  }
  const screens = Array.from(screenUsers)
    .map(([screen, value]) => ({
      screen: pageLabel(screen),
      screenKey: screen,
      index: value.index,
      users: value.users.size,
    }))
    .sort((a, b) => a.index - b.index);

  const skipUsers = new Map<string, Set<string>>();
  for (const event of onboardingEvents.filter((item) => item.event === ONBOARDING_SKIP_EVENT)) {
    const screen = String(event.properties.screen || 'Unknown');
    if (!skipUsers.has(screen)) skipUsers.set(screen, new Set());
    skipUsers.get(screen)?.add(event.properties.distinct_id);
  }
  const skipPoints = Array.from(skipUsers)
    .map(([screen, users]) => ({ screen: pageLabel(screen), users: users.size }))
    .sort((a, b) => b.users - a.users);

  const authMethods = new Map<string, Set<string>>();
  for (const event of onboardingEvents.filter((item) => ONBOARDING_AUTH_EVENTS.includes(item.event))) {
    const method = String(event.properties.method || 'unknown');
    if (!authMethods.has(method)) authMethods.set(method, new Set());
    authMethods.get(method)?.add(event.properties.distinct_id);
  }

  const accountCreated = unionUsers(
    uniqueUsersFor(events, SIGNUP_EVENTS),
    uniqueUsersFor(events, ['onboarding_v2_account_created']),
  );
  const gateUsers = screenUsers.get('paper_gate')?.users || new Set<string>();
  const paywallUsers = usersFor(
    events,
    (event) => event.event === 'Paywall_Viewed' && event.properties.source === FIRST_RUN_PAYWALL_SOURCE,
  );
  const purchaseStarted = usersFor(
    events,
    (event) => event.event === 'Purchase_Initiated' && event.properties.source === FIRST_RUN_PAYWALL_SOURCE,
  );
  const planSelected = usersFor(
    events,
    (event) => event.event === 'Plan_Selected' && event.properties.source === FIRST_RUN_PAYWALL_SOURCE,
  );
  const subscribed = usersFor(
    events,
    (event) => PURCHASE_EVENTS.includes(event.event) && event.properties.source === FIRST_RUN_PAYWALL_SOURCE,
  );

  return {
    funnel: buildFunnel([
      { name: 'Onboarding Started', count: started.size },
      { name: 'Auth Gate Reached', count: gateUsers.size },
      { name: 'Account Created', count: accountCreated.size },
      { name: 'Onboarding Completed', count: completed.size },
      { name: 'First-Query Paywall', count: paywallUsers.size },
      { name: 'Plan Selected', count: planSelected.size },
      { name: 'Purchase Started', count: purchaseStarted.size },
      { name: 'Subscribed', count: subscribed.size },
    ]),
    statCards: [
      { label: 'Onboarding Completion', value: safeDiv(completed.size, started.size), format: 'percentage' as const },
      { label: 'Gate Reach Rate', value: safeDiv(gateUsers.size, started.size), format: 'percentage' as const },
      { label: 'Signup → Paywall', value: safeDiv(paywallUsers.size, accountCreated.size), format: 'percentage' as const },
      { label: 'Paywall → Subscriber', value: safeDiv(subscribed.size, paywallUsers.size), format: 'percentage' as const },
    ],
    onboarding: {
      started: started.size,
      completed: completed.size,
      skipped: usersFor(onboardingEvents, (event) => event.event === ONBOARDING_SKIP_EVENT).size,
      completionRate: safeDiv(completed.size, started.size),
      screenFunnel: buildFunnel([
        { name: 'Started', count: started.size },
        ...screens.map((screen) => ({ name: screen.screen, count: screen.users })),
      ]),
      skipPoints,
      authMethods: Array.from(authMethods).map(([method, users]) => ({ method: pageLabel(method), users: users.size })),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const rawPlatform = searchParams.get('platform') || 'web';
    const userType = (searchParams.get('userType') || 'all') as UserType;
    const supported = new Set<PlatformGroup>(['web', 'iOS', 'iPadOS', 'macOS', 'visionOS']);
    const legacyPlatform = rawPlatform === 'ios' ? 'iOS' : rawPlatform;
    const platform = supported.has(legacyPlatform as PlatformGroup)
      ? (legacyPlatform as PlatformGroup)
      : 'web';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const events = filterByUserType(allEvents, userType).filter(
      (event) => getPlatformGroup(event) === platform,
    );
    const days = getDaysInRange(dateRange.from, dateRange.to);

    if (platform === 'web') {
      const web = buildWebMetrics(events);
      return NextResponse.json({
        platform,
        subtitle: 'Marketing page visit → account creation → subscription',
        funnel: web.funnel,
        statCards: web.statCards,
        dailyData: buildDailyData(events, days, [
          { key: 'marketing', match: (event) => event.event === 'Page_Viewed' },
          { key: 'signup', match: (event) => SIGNUP_EVENTS.includes(event.event) },
          { key: 'subscriber', match: (event) => PURCHASE_EVENTS.includes(event.event) },
        ]),
        dailyLines: [
          { key: 'marketing', color: '#f59e0b', name: 'Marketing Visitors' },
          { key: 'signup', color: '#3b82f6', name: 'Accounts Created' },
          { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
        ],
        topPages: web.topPages,
        webPageAttribution: web.pageAttribution,
        lastUpdated: getLastUpdated(),
      });
    }

    const apple = buildAppleMetrics(events);
    return NextResponse.json({
      platform,
      subtitle: 'Paper onboarding → signup → first-query paywall → subscription',
      funnel: apple.funnel,
      statCards: apple.statCards,
      dailyData: buildDailyData(events, days, [
        { key: 'onboardingStarted', match: (event) => ONBOARDING_START_EVENTS.includes(event.event) && event.properties.onboarding_entry_mode !== 'returning_gate' },
        { key: 'gateReached', match: (event) => event.event === ONBOARDING_SCREEN_EVENT && event.properties.screen === 'paper_gate' && event.properties.onboarding_entry_mode !== 'returning_gate' },
        { key: 'signup', match: (event) => SIGNUP_EVENTS.includes(event.event) || event.event === 'onboarding_v2_account_created' },
        { key: 'paywall', match: (event) => event.event === 'Paywall_Viewed' && event.properties.source === FIRST_RUN_PAYWALL_SOURCE },
        { key: 'subscriber', match: (event) => PURCHASE_EVENTS.includes(event.event) && event.properties.source === FIRST_RUN_PAYWALL_SOURCE },
      ]),
      dailyLines: [
        { key: 'onboardingStarted', color: '#f59e0b', name: 'Onboarding Started' },
        { key: 'gateReached', color: '#8b5cf6', name: 'Auth Gate Reached' },
        { key: 'signup', color: '#3b82f6', name: 'Account Created' },
        { key: 'paywall', color: '#ec4899', name: 'First-Query Paywall' },
        { key: 'subscriber', color: '#10b981', name: 'Subscribed' },
      ],
      appleOnboarding: apple.onboarding,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching acquisition metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch acquisition metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
