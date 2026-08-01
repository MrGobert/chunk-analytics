import {
  categorizeUsers,
  expandEventNames,
  filterEventsByType,
  getUniqueUsersByDate,
  isRealUser,
  normalizeEventName,
  referrerHost,
} from '@/lib/mixpanel';
import {
  ALL_FEATURE_EVENTS,
  categorizeEvent,
  isFeatureActivityEvent,
} from '@/lib/feature-categories';
import { formatDate, getDaysInRange, shiftDate } from '@/lib/utils';
import type { MixpanelEvent } from '@/types/mixpanel';

/**
 * Classification context must travel with the narrow engagement export.
 * Otherwise authenticated/subscriber filters silently classify every user as
 * a visitor when the export contains only product-activity events.
 */
export const ENGAGEMENT_USER_CONTEXT_EVENTS = [
  'Signup_Completed',
  'Login_Completed',
  'Purchase_Completed',
  'Subscription_Started',
] as const;

/**
 * The full Mixpanel export is tens of megabytes and regularly exceeds Vercel's
 * function limit. These are the only events required by Users, Advanced, and
 * Power Users.
 */
export const ENGAGEMENT_EXPORT_EVENT_NAMES = expandEventNames([
  ...ALL_FEATURE_EVENTS,
  ...ENGAGEMENT_USER_CONTEXT_EVENTS,
  'App_Session_Started',
  'Marketing_Session_Started',
  '$ae_first_open',
]);

/** Sessions and genuine feature use define active product usage. */
export function isEngagementActivityEvent(event: MixpanelEvent): boolean {
  return (
    normalizeEventName(event.event) === 'App_Session_Started' ||
    isFeatureActivityEvent(event)
  );
}

export function getEngagementActivityEvents(events: MixpanelEvent[]): MixpanelEvent[] {
  return events.filter(isEngagementActivityEvent);
}

function eventDay(event: MixpanelEvent): string {
  return formatDate(new Date(event.properties.time * 1000));
}

/** Sunday-start calendar week in the Mixpanel project's UTC timezone. */
export function engagementWeekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return shiftDate(day, -date.getUTCDay());
}

function engagementMonth(day: string): string {
  return day.slice(0, 7);
}

export function aggregateUserEngagement(
  events: MixpanelEvent[],
  dateRange: { from: string; to: string },
) {
  const activityEvents = getEngagementActivityEvents(events);
  const days = getDaysInRange(dateRange.from, dateRange.to);
  const usersByDate = getUniqueUsersByDate(activityEvents);
  const dau = days.map((date) => ({
    date,
    users: usersByDate.get(date)?.size || 0,
  }));

  const weeklyUsers = new Map<string, Set<string>>();
  for (const day of days) weeklyUsers.set(engagementWeekStart(day), new Set());
  const monthlyUsers = new Map<string, Set<string>>();
  for (const day of days) monthlyUsers.set(engagementMonth(day), new Set());

  for (const event of activityEvents) {
    const uid = event.properties.distinct_id;
    if (!uid) continue;
    const day = eventDay(event);
    weeklyUsers.get(engagementWeekStart(day))?.add(uid);
    monthlyUsers.get(engagementMonth(day))?.add(uid);
  }

  const wau = Array.from(weeklyUsers, ([week, users]) => ({
    week,
    users: users.size,
  })).sort((a, b) => a.week.localeCompare(b.week));
  const mau = Array.from(monthlyUsers, ([month, users]) => ({
    month,
    users: users.size,
  })).sort((a, b) => a.month.localeCompare(b.month));

  // Normalize raw Apple `$ae_session` and web `Session_Started` aliases so all
  // app sessions contribute to the session charts.
  const sessionEvents = events.filter(
    (event) => normalizeEventName(event.event) === 'App_Session_Started',
  );
  const durations = sessionEvents
    .map((event) => Number(event.properties.$ae_session_length) || 0)
    .filter((duration) => duration > 0 && duration < 7200);
  const durationRanges = [
    { range: '0-30s', min: 0, max: 30 },
    { range: '30s-1m', min: 30, max: 60 },
    { range: '1-5m', min: 60, max: 300 },
    { range: '5-15m', min: 300, max: 900 },
    { range: '15-30m', min: 900, max: 1800 },
    { range: '30m+', min: 1800, max: Infinity },
  ];
  const sessionDurations = durationRanges.map(({ range, min, max }) => ({
    range,
    count: durations.filter((duration) => duration >= min && duration < max).length,
  }));

  const sessionsByUser = new Map<string, number>();
  for (const event of sessionEvents) {
    const uid = event.properties.distinct_id;
    if (uid) sessionsByUser.set(uid, (sessionsByUser.get(uid) || 0) + 1);
  }
  const sessionCounts = Array.from(sessionsByUser.values());
  const sessionsPerUser = [
    { sessions: '1', users: sessionCounts.filter((count) => count === 1).length },
    { sessions: '2-3', users: sessionCounts.filter((count) => count >= 2 && count <= 3).length },
    { sessions: '4-5', users: sessionCounts.filter((count) => count >= 4 && count <= 5).length },
    { sessions: '6-10', users: sessionCounts.filter((count) => count >= 6 && count <= 10).length },
    { sessions: '10+', users: sessionCounts.filter((count) => count > 10).length },
  ];

  const countryUsers = new Map<string, Set<string>>();
  for (const event of activityEvents) {
    const uid = event.properties.distinct_id;
    if (!uid) continue;
    const country = String(event.properties.mp_country_code || 'Unknown');
    if (!countryUsers.has(country)) countryUsers.set(country, new Set());
    countryUsers.get(country)!.add(uid);
  }
  const activeUsers = new Set(
    activityEvents.map((event) => event.properties.distinct_id).filter(Boolean),
  );
  const geographic = Array.from(countryUsers, ([country, users]) => ({
    country,
    users: users.size,
    percentage: activeUsers.size > 0 ? (users.size / activeUsers.size) * 100 : 0,
  }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 10);

  return { dau, wau, mau, sessionDurations, sessionsPerUser, geographic };
}

function utcDayDifference(later: MixpanelEvent, earlier: MixpanelEvent): number {
  const laterDay = new Date(`${eventDay(later)}T12:00:00Z`).getTime();
  const earlierDay = new Date(`${eventDay(earlier)}T12:00:00Z`).getTime();
  return Math.round((laterDay - earlierDay) / 86_400_000);
}

export function aggregateAdvancedEngagement(
  events: MixpanelEvent[],
  dateRange: { from: string; to: string },
) {
  const activityEvents = getEngagementActivityEvents(events);
  const days = getDaysInRange(dateRange.from, dateRange.to);
  const usersByDate = getUniqueUsersByDate(activityEvents);
  const dailyUserCounts = days.map((date) => usersByDate.get(date)?.size || 0);
  const avgDAU =
    dailyUserCounts.reduce((total, count) => total + count, 0) /
    Math.max(1, dailyUserCounts.length);
  const activeUserIds = new Set(
    activityEvents.map((event) => event.properties.distinct_id).filter(Boolean),
  );
  const mau = activeUserIds.size;
  const dauMauRatio = mau > 0 ? avgDAU / mau : 0;

  const firstOpenEvents = events.filter((event) => event.event === '$ae_first_open');
  const firstOpenByUser = new Map<string, MixpanelEvent>();
  for (const event of firstOpenEvents) {
    const uid = event.properties.distinct_id;
    const existing = firstOpenByUser.get(uid);
    if (!existing || event.properties.time < existing.properties.time) {
      firstOpenByUser.set(uid, event);
    }
  }
  const sessionEvents = events.filter(
    (event) => normalizeEventName(event.event) === 'App_Session_Started',
  );
  const sessionsByUser = new Map<string, MixpanelEvent[]>();
  for (const event of sessionEvents) {
    const uid = event.properties.distinct_id;
    if (!sessionsByUser.has(uid)) sessionsByUser.set(uid, []);
    sessionsByUser.get(uid)!.push(event);
  }
  const retained = {
    day1: new Set<string>(),
    day7: new Set<string>(),
    day30: new Set<string>(),
  };
  for (const [uid, firstOpen] of firstOpenByUser) {
    for (const session of sessionsByUser.get(uid) || []) {
      const difference = utcDayDifference(session, firstOpen);
      if (difference >= 1 && difference <= 2) retained.day1.add(uid);
      if (difference >= 6 && difference <= 8) retained.day7.add(uid);
      if (difference >= 28 && difference <= 32) retained.day30.add(uid);
    }
  }
  const newUsers = firstOpenByUser.size;
  const retention = {
    day1: newUsers > 0 ? (retained.day1.size / newUsers) * 100 : 0,
    day7: newUsers > 0 ? (retained.day7.size / newUsers) * 100 : 0,
    day30: newUsers > 0 ? (retained.day30.size / newUsers) * 100 : 0,
    totalNewUsers: newUsers,
  };

  const userCategories = categorizeUsers(events);
  const paidUserIds = new Set(
    [...activeUserIds].filter((uid) => userCategories.get(uid) === 'subscriber'),
  );
  const authenticatedUserIds = new Set(
    [...activeUserIds].filter((uid) => {
      const category = userCategories.get(uid);
      return category === 'authenticated' || category === 'subscriber';
    }),
  );
  const paidUsers = paidUserIds.size;
  const authenticatedUsers = authenticatedUserIds.size;
  const freeUsers = Math.max(0, authenticatedUsers - paidUsers);
  const guestUsers = Math.max(0, activeUserIds.size - authenticatedUsers);
  const paidPercentage =
    authenticatedUsers > 0 ? (paidUsers / authenticatedUsers) * 100 : 0;

  const trafficSessionEvents = events.filter((event) => {
    const canonical = normalizeEventName(event.event);
    return (
      canonical === 'App_Session_Started' ||
      canonical === 'Marketing_Session_Started'
    );
  });
  const referrerCounts = new Map<string, number>();
  const utmSourceCounts = new Map<string, number>();
  for (const event of trafficSessionEvents) {
    const source = referrerHost(
      event.properties.referrer_domain ??
        event.properties.referrer ??
        event.properties.$referrer,
    );
    referrerCounts.set(source, (referrerCounts.get(source) || 0) + 1);
    const campaign = event.properties.utm_source;
    if (campaign) {
      const name = String(campaign);
      utmSourceCounts.set(name, (utmSourceCounts.get(name) || 0) + 1);
    }
  }
  const trafficSources = Array.from(referrerCounts, ([source, sessions]) => ({
    source,
    sessions,
  }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);
  const utmSources = Array.from(utmSourceCounts, ([campaign, sessions]) => ({
    campaign,
    sessions,
  }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);

  const sessionLengths = sessionEvents
    .map((event) => Number(event.properties.$ae_session_length) || 0)
    .filter((length) => length > 0 && length < 7200);
  const avgSessionDuration =
    sessionLengths.length > 0
      ? sessionLengths.reduce((total, length) => total + length, 0) /
        sessionLengths.length
      : 0;
  const searchEvents = filterEventsByType(activityEvents, ['Search_Performed']);
  const searchesPerUser = mau > 0 ? searchEvents.length / mau : 0;

  const featureDefinitions = [
    { events: ['Note_Created'], name: 'Notes' },
    { events: ['Document_Uploaded'], name: 'Documents' },
    { events: ['Image_Generation_Completed'], name: 'Image Generation' },
    { events: ['Collection_Created'], name: 'Collections' },
    { events: ['Memory_Added'], name: 'Memory' },
    { events: ['Research_Report_Completed'], name: 'Research Reports' },
    { events: ['Note_Writing_Tool_Used'], name: 'Writing Tools' },
    { events: ['Search_Performed'], name: 'Searches' },
    { events: ['Automation_Created'], name: 'Automations' },
    { events: ['inbox_capture_created'], name: 'Captures' },
  ];
  const featureAdoption = featureDefinitions
    .map(({ events: names, name: feature }) => {
      const users = new Set(
        filterEventsByType(activityEvents, names).map(
          (event) => event.properties.distinct_id,
        ),
      );
      return {
        feature,
        users: users.size,
        adoptionRate: mau > 0 ? (users.size / mau) * 100 : 0,
      };
    })
    .sort((a, b) => b.adoptionRate - a.adoptionRate);

  return {
    dauMauRatio: Math.round(dauMauRatio * 100) / 100,
    avgDAU: Math.round(avgDAU),
    mau,
    avgSessionDuration: Math.round(avgSessionDuration),
    searchesPerUser: Math.round(searchesPerUser * 10) / 10,
    retention,
    userBreakdown: {
      total: activeUserIds.size,
      paid: paidUsers,
      free: freeUsers,
      paidPercentage: Math.round(paidPercentage * 10) / 10,
      guest: guestUsers,
      authenticated: authenticatedUsers,
    },
    trafficSources,
    utmSources,
    featureAdoption,
  };
}

export function aggregatePowerUsers(
  events: MixpanelEvent[],
  dateRange: { from: string; to: string },
) {
  const activityEvents = getEngagementActivityEvents(events);
  const days = getDaysInRange(dateRange.from, dateRange.to);
  const windowDays = Math.max(1, days.length);
  const lastDays = new Set(days.slice(-7));
  const subscribers = categorizeUsers(events);
  interface UserAccumulator {
    activeDays: Set<string>;
    featureCategories: Set<string>;
    eventCount: number;
    activeInLast7: boolean;
  }
  const users = new Map<string, UserAccumulator>();

  for (const event of activityEvents) {
    const uid = event.properties.distinct_id;
    if (!isRealUser(uid)) continue;
    if (!users.has(uid)) {
      users.set(uid, {
        activeDays: new Set(),
        featureCategories: new Set(),
        eventCount: 0,
        activeInLast7: false,
      });
    }
    const accumulator = users.get(uid)!;
    const day = eventDay(event);
    accumulator.activeDays.add(day);
    accumulator.eventCount++;
    if (lastDays.has(day)) accumulator.activeInLast7 = true;
    const category = categorizeEvent(event.event);
    if (category) accumulator.featureCategories.add(category);
  }

  const counts = {
    power: 0,
    core: 0,
    casual: 0,
    dormant: 0,
    powerSubscribers: 0,
    coreSubscribers: 0,
    casualSubscribers: 0,
    dormantSubscribers: 0,
  };
  const ranked: {
    uid: string;
    activeDays: number;
    features: number;
    events: number;
    subscriber: boolean;
  }[] = [];

  for (const [uid, activity] of users) {
    const activeDays = activity.activeDays.size;
    const perWeek = activeDays / (Math.max(7, windowDays) / 7);
    const subscriber = subscribers.get(uid) === 'subscriber';
    let segment: 'power' | 'core' | 'casual' | 'dormant';
    if (!activity.activeInLast7) segment = 'dormant';
    else if (perWeek >= 5 && activity.featureCategories.size >= 3) segment = 'power';
    else if (perWeek >= 2) segment = 'core';
    else segment = 'casual';
    counts[segment]++;
    if (subscriber) {
      const key = `${segment}Subscribers` as
        | 'powerSubscribers'
        | 'coreSubscribers'
        | 'casualSubscribers'
        | 'dormantSubscribers';
      counts[key]++;
    }
    ranked.push({
      uid,
      activeDays,
      features: activity.featureCategories.size,
      events: activity.eventCount,
      subscriber,
    });
  }

  ranked.sort(
    (a, b) => b.activeDays - a.activeDays || b.events - a.events,
  );
  const breadth = new Map<number, number>();
  for (const activity of users.values()) {
    const count = activity.featureCategories.size;
    breadth.set(count, (breadth.get(count) || 0) + 1);
  }

  return {
    totalUsers: users.size,
    segments: [
      {
        segment: 'Power',
        count: counts.power,
        subscribers: counts.powerSubscribers,
        description: '≥5 active days/wk · ≥3 features',
      },
      {
        segment: 'Core',
        count: counts.core,
        subscribers: counts.coreSubscribers,
        description: '2–4 active days/wk',
      },
      {
        segment: 'Casual',
        count: counts.casual,
        subscribers: counts.casualSubscribers,
        description: 'Active, <2 days/wk',
      },
      {
        segment: 'Dormant',
        count: counts.dormant,
        subscribers: counts.dormantSubscribers,
        description: 'No activity in last 7d',
      },
    ],
    topUsers: ranked.slice(0, 50),
    featureBreadth: Array.from(breadth, ([features, count]) => ({
      features: String(features),
      users: count,
    })).sort((a, b) => Number(a.features) - Number(b.features)),
  };
}
