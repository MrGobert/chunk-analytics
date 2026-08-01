import {
  FEATURE_DEFINITIONS,
  type FeatureCategory,
  categorizeEvent,
  isFeatureActivityEvent,
  isPrimaryFeatureEvent,
  ALL_FEATURE_EVENTS,
} from '@/lib/feature-categories';
import {
  calculateTrend,
  expandEventNames,
  normalizeEventName,
} from '@/lib/mixpanel';
import { formatDate } from '@/lib/utils';
import type { MixpanelEvent, TopMover } from '@/types/mixpanel';

/**
 * One canonical filtered export serves both Pulse and the Features overview.
 * Besides feature activity it includes the small amount of context required by
 * Pulse KPIs, user-type classification, active-user adoption, and Memory state.
 */
export const FEATURE_ACTIVITY_EXPORT_EVENT_NAMES = expandEventNames([
  ...ALL_FEATURE_EVENTS,
  'App_Session_Started',
  'Signup_Completed',
  'Login_Completed',
  'Paywall_Viewed',
  'Plan_Selected',
  'Purchase_Initiated',
  'Purchase_Completed',
  'Purchase_Failed',
  'Subscription_Started',
  'Search_Failed',
  'Onboarding_Completed',
]);

export interface FeatureActivityAggregationOptions {
  currentDays: string[];
  priorDays: string[];
}

export interface FeatureActivityBreakdown {
  event: string;
  label: string;
  current: number;
  previous: number;
}

export interface FeatureActivityMetric {
  name: FeatureCategory;
  /** All genuine lifecycle activity used for adoption/stickiness. */
  totalEvents: number;
  /** Comparable value-producing actions used by Top Movers. */
  primaryActions: number;
  previousPrimaryActions: number;
  uniqueUsers: number;
  trend: number | null;
  activityTrend: number | null;
  stickiness: number;
  adoptionRate: number;
  unit: string;
  breakdown: FeatureActivityBreakdown[];
}

interface CategoryAccumulator {
  totalEvents: number;
  primaryActions: number;
  uniqueUsers: Set<string>;
  dailyUsers: Map<string, Set<string>>;
  breakdown: Map<string, number>;
}

function eventDay(event: MixpanelEvent): string {
  return formatDate(new Date(event.properties.time * 1000));
}

/**
 * Mixpanel promises insert-id deduplication at ingestion, but independently
 * cached export variants can still surface duplicate rows. Guard category
 * totals without collapsing legitimate repeated events that lack an insert id.
 */
export function dedupeMixpanelEvents(events: MixpanelEvent[]): MixpanelEvent[] {
  const seenInsertIds = new Set<string>();
  return events.filter((event) => {
    const insertId = event.properties.$insert_id;
    if (!insertId) return true;
    if (seenInsertIds.has(insertId)) return false;
    seenInsertIds.add(insertId);
    return true;
  });
}

function emptyAccumulator(): CategoryAccumulator {
  return {
    totalEvents: 0,
    primaryActions: 0,
    uniqueUsers: new Set(),
    dailyUsers: new Map(),
    breakdown: new Map(),
  };
}

function aggregatePeriod(events: MixpanelEvent[]): Map<FeatureCategory, CategoryAccumulator> {
  const result = new Map<FeatureCategory, CategoryAccumulator>();
  for (const category of Object.keys(FEATURE_DEFINITIONS) as FeatureCategory[]) {
    result.set(category, emptyAccumulator());
  }

  for (const event of events) {
    const category = categorizeEvent(event.event);
    if (!category || !isFeatureActivityEvent(event)) continue;

    const accumulator = result.get(category)!;
    const uid = event.properties.distinct_id;
    const day = eventDay(event);
    accumulator.totalEvents++;
    if (uid) {
      accumulator.uniqueUsers.add(uid);
      if (!accumulator.dailyUsers.has(day)) accumulator.dailyUsers.set(day, new Set());
      accumulator.dailyUsers.get(day)!.add(uid);
    }

    if (isPrimaryFeatureEvent(category, event)) {
      const canonical = normalizeEventName(event.event);
      accumulator.primaryActions++;
      accumulator.breakdown.set(canonical, (accumulator.breakdown.get(canonical) || 0) + 1);
    }
  }

  return result;
}

function getMemoryEnabledUsers(events: MixpanelEvent[]): Set<string> {
  const latestToggle = new Map<string, { enabled: boolean; time: number }>();
  for (const event of events) {
    const canonical = normalizeEventName(event.event);
    const uid = event.properties.distinct_id;
    if (!uid) continue;
    if (canonical === 'Memory_Toggled') {
      const value = event.properties.enabled;
      const enabled = value === true || value === 1 || value === 'true' || value === '1';
      const time = event.properties.time;
      const existing = latestToggle.get(uid);
      if (!existing || time > existing.time) latestToggle.set(uid, { enabled, time });
    }
  }

  const enabledUsers = new Set<string>();
  for (const [uid, state] of latestToggle) {
    if (state.enabled) enabledUsers.add(uid);
  }
  for (const event of events) {
    if (
      normalizeEventName(event.event) === 'Onboarding_Completed' &&
      event.properties.source === 'memory_modal'
    ) {
      const uid = event.properties.distinct_id;
      const toggle = latestToggle.get(uid);
      if (uid && (!toggle || toggle.enabled)) enabledUsers.add(uid);
    }
  }
  return enabledUsers;
}

function buildTopMovers(features: FeatureActivityMetric[]): {
  gainers: TopMover[];
  decliners: TopMover[];
} {
  const movers: TopMover[] = features
    .map((feature) => {
      const previous = feature.previousPrimaryActions;
      return {
        category: feature.name,
        current: feature.primaryActions,
        previous,
        change: feature.trend,
        delta: feature.primaryActions - previous,
        unit: feature.unit,
        breakdown: feature.breakdown,
      };
    })
    .filter((mover) => mover.current !== mover.previous);

  // Absolute movement is the primary ranking signal. Percentage change only
  // breaks ties, preventing a tiny 0→1 category from outranking material growth.
  const gainers = movers
    .filter((mover) => mover.delta > 0)
    .sort((a, b) => b.delta - a.delta || (b.change ?? 0) - (a.change ?? 0))
    .slice(0, 3);
  const decliners = movers
    .filter((mover) => mover.delta < 0)
    .sort((a, b) => a.delta - b.delta || (a.change ?? 0) - (b.change ?? 0))
    .slice(0, 3);

  return { gainers, decliners };
}

export function aggregateFeatureActivity(
  events: MixpanelEvent[],
  { currentDays, priorDays }: FeatureActivityAggregationOptions,
) {
  const deduplicatedEvents = dedupeMixpanelEvents(events);
  const currentDaySet = new Set(currentDays);
  const priorDaySet = new Set(priorDays);
  const currentEvents = deduplicatedEvents.filter((event) => currentDaySet.has(eventDay(event)));
  const priorEvents = deduplicatedEvents.filter((event) => priorDaySet.has(eventDay(event)));
  const currentStats = aggregatePeriod(currentEvents);
  const priorStats = aggregatePeriod(priorEvents);
  const numDays = Math.max(1, currentDays.length);

  const activeUsers = new Set<string>();
  for (const event of currentEvents) {
    const uid = event.properties.distinct_id;
    if (!uid) continue;
    if (
      normalizeEventName(event.event) === 'App_Session_Started' ||
      isFeatureActivityEvent(event)
    ) {
      activeUsers.add(uid);
    }
  }

  const features: FeatureActivityMetric[] = (
    Object.keys(FEATURE_DEFINITIONS) as FeatureCategory[]
  ).map((category) => {
    const definition = FEATURE_DEFINITIONS[category];
    const current = currentStats.get(category)!;
    const prior = priorStats.get(category)!;
    let dailyUserSum = 0;
    for (const users of current.dailyUsers.values()) dailyUserSum += users.size;
    const averageDau = dailyUserSum / numDays;

    const breakdown = definition.primaryActionEvents
      .map((event) => ({
        event,
        label: (definition.eventLabels as Readonly<Record<string, string>>)[event] ?? event,
        current: current.breakdown.get(event) || 0,
        previous: prior.breakdown.get(event) || 0,
      }))
      .filter((item) => item.current > 0 || item.previous > 0);

    return {
      name: category,
      totalEvents: current.totalEvents,
      primaryActions: current.primaryActions,
      previousPrimaryActions: prior.primaryActions,
      uniqueUsers: current.uniqueUsers.size,
      trend: calculateTrend(current.primaryActions, prior.primaryActions),
      activityTrend: calculateTrend(current.totalEvents, prior.totalEvents),
      stickiness:
        current.uniqueUsers.size > 0 ? averageDau / current.uniqueUsers.size : 0,
      adoptionRate:
        activeUsers.size > 0 ? current.uniqueUsers.size / activeUsers.size : 0,
      unit: definition.unit,
      breakdown,
    };
  }).sort(
    (a, b) =>
      b.primaryActions - a.primaryActions ||
      b.totalEvents - a.totalEvents ||
      a.name.localeCompare(b.name),
  );

  const memoryEnabledUsers = getMemoryEnabledUsers(currentEvents);
  const priorMemoryEnabledUsers = getMemoryEnabledUsers(priorEvents);

  return {
    features,
    topMovers: buildTopMovers(features),
    memoryEnabled: {
      uniqueUsers: memoryEnabledUsers.size,
      trend: calculateTrend(memoryEnabledUsers.size, priorMemoryEnabledUsers.size),
    },
    deduplicatedCount: events.length - deduplicatedEvents.length,
  };
}
