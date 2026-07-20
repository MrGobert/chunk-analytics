import { ALL_FEATURE_EVENTS, categorizeEvent, KEY_ACTION_EVENTS } from '@/lib/feature-categories';
import {
  calculateTrend,
  countEvents,
  expandEventNames,
  isRealUser,
  normalizeEventName,
} from '@/lib/mixpanel';
import { formatDate, shiftDate } from '@/lib/utils';
import type { MixpanelEvent, TopMover } from '@/types/mixpanel';

const SESSION_EVENTS = ['App_Session_Started'];
const BUSINESS_EVENTS = [
  'Signup_Completed',
  'Paywall_Viewed',
  'Plan_Selected',
  'Purchase_Initiated',
  'Purchase_Completed',
  'Purchase_Failed',
  'Search_Failed',
];

/**
 * Exact raw names requested from Mixpanel. This keeps Pulse small enough for a
 * cold Vercel request while still including Apple auto-session events, web app
 * sessions, product activity, funnel events, and all known legacy aliases.
 */
export const PULSE_EVENT_NAMES = expandEventNames([
  ...ALL_FEATURE_EVENTS,
  ...SESSION_EVENTS,
  ...BUSINESS_EVENTS,
]);

const ACTIVE_USER_EVENTS = new Set([...ALL_FEATURE_EVENTS, ...SESSION_EVENTS]);
const KEY_ACTIONS = new Set(KEY_ACTION_EVENTS);

export interface PulseAggregationOptions {
  currentDays: string[];
  priorDays: string[];
  today: string;
}

function eventDay(event: MixpanelEvent): string {
  return formatDate(new Date(event.properties.time * 1000));
}

function uniqueUsers(
  events: MixpanelEvent[],
  predicate: (event: MixpanelEvent) => boolean,
): number {
  return new Set(
    events
      .filter(predicate)
      .map((event) => event.properties.distinct_id)
      .filter(Boolean),
  ).size;
}

function isTruthyProperty(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

function isTrialPurchase(event: MixpanelEvent): boolean {
  return (
    normalizeEventName(event.event) === 'Purchase_Completed' &&
    (isTruthyProperty(event.properties.is_trial) || isTruthyProperty(event.properties.has_trial))
  );
}

function activeCreators(events: MixpanelEvent[]): Set<string> {
  const users = new Set<string>();
  for (const event of events) {
    const uid = event.properties.distinct_id;
    if (KEY_ACTIONS.has(normalizeEventName(event.event)) && isRealUser(uid)) users.add(uid);
  }
  return users;
}

function categoryVolume(events: MixpanelEvent[]): Map<string, number> {
  const volume = new Map<string, number>();
  for (const event of events) {
    const category = categorizeEvent(event.event);
    if (category) volume.set(category, (volume.get(category) || 0) + 1);
  }
  return volume;
}

function buildTopMovers(currentEvents: MixpanelEvent[], priorEvents: MixpanelEvent[]) {
  const currentVolume = categoryVolume(currentEvents);
  const priorVolume = categoryVolume(priorEvents);
  const categories = new Set([...currentVolume.keys(), ...priorVolume.keys()]);

  const movers: TopMover[] = Array.from(categories)
    .map((category) => {
      const current = currentVolume.get(category) || 0;
      const previous = priorVolume.get(category) || 0;
      return { category, current, previous, change: calculateTrend(current, previous) };
    })
    // Include newly adopted categories (change=null) and low-volume short
    // windows. A hard minimum of five made Today and many 7-day views blank.
    .filter((mover) => mover.current !== mover.previous && (mover.current > 0 || mover.previous > 0));

  const gainers = movers
    .filter((mover) => mover.current > mover.previous)
    .sort((a, b) => {
      if (a.previous === 0 && b.previous !== 0) return -1;
      if (b.previous === 0 && a.previous !== 0) return 1;
      return (b.change ?? 0) - (a.change ?? 0) || b.current - a.current;
    })
    .slice(0, 3);
  const decliners = movers
    .filter((mover) => mover.current < mover.previous)
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0) || b.previous - a.previous)
    .slice(0, 3);

  return { gainers, decliners };
}

/** Aggregate an already platform/user-filtered Pulse export. */
export function aggregatePulseMetrics(
  events: MixpanelEvent[],
  { currentDays, priorDays, today }: PulseAggregationOptions,
) {
  const currentDaySet = new Set(currentDays);
  const priorDaySet = new Set(priorDays);
  const currentEvents = events.filter((event) => currentDaySet.has(eventDay(event)));
  const priorEvents = events.filter((event) => priorDaySet.has(eventDay(event)));
  const todayEvents = events.filter((event) => eventDay(event) === today);

  // DAU is intentionally based on sessions or genuine product activity, not
  // signup/paywall events. This avoids counting a marketing conversion as an
  // active product user while retaining Apple users via $ae_session aliases.
  const activeEvents = events.filter((event) => ACTIVE_USER_EVENTS.has(normalizeEventName(event.event)));
  const usersByDate = new Map<string, Set<string>>();
  for (const event of activeEvents) {
    const uid = event.properties.distinct_id;
    if (!uid) continue;
    const date = eventDay(event);
    if (!usersByDate.has(date)) usersByDate.set(date, new Set());
    usersByDate.get(date)?.add(uid);
  }

  const yesterday = shiftDate(today, -1);
  const sameWeekdayLastWeek = shiftDate(today, -7);
  const dauTrend = currentDays.map((date) => ({ date, users: usersByDate.get(date)?.size || 0 }));
  const currentCreators = activeCreators(currentEvents).size;
  const priorCreators = activeCreators(priorEvents).size;

  const canonicalIs = (event: MixpanelEvent, name: string) => normalizeEventName(event.event) === name;
  const snapshot = (scopeEvents: MixpanelEvent[]) => ({
    signups: uniqueUsers(scopeEvents, (event) => canonicalIs(event, 'Signup_Completed')),
    trialStarts: uniqueUsers(scopeEvents, isTrialPurchase),
    purchases: uniqueUsers(scopeEvents, (event) => canonicalIs(event, 'Purchase_Completed')),
    paywallViews: uniqueUsers(scopeEvents, (event) => canonicalIs(event, 'Paywall_Viewed')),
  });
  const todaySnapshot = snapshot(todayEvents);
  const scopeSnapshot = snapshot(currentEvents);

  const searchFailRate = (scopeEvents: MixpanelEvent[]) => {
    const successful = countEvents(scopeEvents, 'Search_Performed');
    const failed = countEvents(scopeEvents, 'Search_Failed');
    return successful + failed > 0 ? failed / (successful + failed) : 0;
  };
  const trailingSeven = new Set(Array.from({ length: 7 }, (_, index) => shiftDate(today, -index)));
  const trailingSevenEvents = events.filter((event) => trailingSeven.has(eventDay(event)));

  const funnelUnique = (name: string) =>
    uniqueUsers(currentEvents, (event) => canonicalIs(event, name));

  return {
    // Existing fields retained for cached clients.
    todayDAU: usersByDate.get(today)?.size || 0,
    yesterdayDAU: usersByDate.get(yesterday)?.size || 0,
    sameWeekdayDAU: usersByDate.get(sameWeekdayLastWeek)?.size || 0,
    todaySearches: countEvents(todayEvents, 'Search_Performed'),
    dauTrend7d: dauTrend.slice(-7),
    dauTrend14d: dauTrend.slice(-14),
    weeklyActiveCreators: currentCreators,
    weeklyActiveCreatorsPrev: priorCreators,
    wacChange: calculateTrend(currentCreators, priorCreators),
    todaySignups: todaySnapshot.signups,
    todayTrialStarts: todaySnapshot.trialStarts,
    todayPurchases: todaySnapshot.purchases,
    todayPurchaseFailures: countEvents(todayEvents, 'Purchase_Failed'),
    todayPaywallViews: todaySnapshot.paywallViews,

    // Range-aware fields used by the current Pulse UI.
    activeCreators: currentCreators,
    activeCreatorsPrev: priorCreators,
    activeCreatorsChange: calculateTrend(currentCreators, priorCreators),
    rangeDays: currentDays.length,
    dauTrend,
    scopeSignups: scopeSnapshot.signups,
    scopeTrialStarts: scopeSnapshot.trialStarts,
    scopePurchases: scopeSnapshot.purchases,
    scopePaywallViews: scopeSnapshot.paywallViews,

    searchFailRateToday: searchFailRate(todayEvents),
    searchFailRate7d: searchFailRate(trailingSevenEvents),
    microFunnel: {
      paywallViewed: funnelUnique('Paywall_Viewed'),
      planSelected: funnelUnique('Plan_Selected'),
      purchaseInitiated: funnelUnique('Purchase_Initiated'),
      purchaseCompleted: funnelUnique('Purchase_Completed'),
    },
    topMovers: buildTopMovers(currentEvents, priorEvents),
  };
}
