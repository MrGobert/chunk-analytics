// Chat starters: the suggestion cards above an empty chat on web and Apple,
// personalized (Pro + Memory) or from the generic catalog. Pure aggregation
// behind /api/metrics/chat-starters, so every rate here is unit-tested.
//
// Contract: chat starters v2 §8 (2026-09-27). Every client sends `kind`,
// `personalized` and `launch` on the five card events; v2 clients add
// `intent`, `slot_index`, `bundle_age`, `generic_id` and more, plus four new
// events. A property an older client never sent lands in the
// `none (legacy)` row, so each breakdown spans the rollout.
//
// These events carry enums and counts only, never card text. Every property
// value reported here is an integer slot, a platform from platformOf(), or has
// passed enumValue(), so a stray free-text value is counted as `other` and
// never echoed.

import { buildFunnel } from '@/lib/funnel';
import {
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  normalizeEventName,
  platformOf,
  type MixpanelFetchResult,
  type UserType,
} from '@/lib/mixpanel';
import { safeDiv } from '@/lib/utils';
import type {
  ChatStarterPlatformRow,
  ChatStarterRateRow,
  ChatStartersMetrics,
  DateRange,
  MixpanelEvent,
} from '@/types/mixpanel';

const SHOWN_EVENT = 'Chat_Starter_Shown';
const TAPPED_EVENT = 'Chat_Starter_Tapped';
const DRAFT_SENT_EVENT = 'Chat_Starter_Draft_Sent';
const FOLLOWUP_EVENT = 'Chat_Starter_Followup';
const NOT_INTERESTED_EVENT = 'Chat_Starter_Not_Interested';
const FETCHED_EVENT = 'Chat_Starter_Fetched';
const WHY_OPENED_EVENT = 'Chat_Starter_Why_Opened';
const MORE_TAPPED_EVENT = 'Chat_Starter_More_Tapped';
const VALIDATION_FAILED_EVENT = 'Chat_Starter_Validation_Failed';

/** Every event the Starters tab reads (the route adds user-type context events). */
export const CHAT_STARTER_EVENTS = [
  SHOWN_EVENT,
  TAPPED_EVENT,
  DRAFT_SENT_EVENT,
  FOLLOWUP_EVENT,
  NOT_INTERESTED_EVENT,
  FETCHED_EVENT,
  WHY_OPENED_EVENT,
  MORE_TAPPED_EVENT,
  VALIDATION_FAILED_EVENT,
];

/** Personalized-card intents, in table order. */
export const CHAT_STARTER_INTENTS = [
  'resume',
  'next_step',
  'follow_through',
  'whats_new',
  'routine',
  'explore',
] as const;

/** `bundle_age` buckets, youngest first. `none` = the bundle had no generated_at. */
export const CHAT_STARTER_BUNDLE_AGES = ['lt_1h', '1h_6h', '6h_24h', '1d_3d', 'gt_3d', 'none'] as const;

/**
 * The row for cards whose client didn't send the property. For intent it also
 * holds `intent: none` (a card the server sent without one): both are
 * intent-less cards, so the row reads the same before and after the change.
 */
export const LEGACY_BUCKET = 'none (legacy)';
/** The row for a value that isn't a known enum. */
export const OTHER_BUCKET = 'other';
/** The row for one of the new events missing a property it always carries. */
export const UNKNOWN_BUCKET = 'unknown';

/** The generic catalog has 12 cards; malformed ids fold into `other`. */
const TOP_GENERIC_LIMIT = 12;

const PLATFORM_ORDER = ['Web', 'iOS', 'iPadOS', 'macOS', 'visionOS', 'Other'];

// Lowercase snake or kebab case, the shape of every enum in the contract.
// Anything else (spaces, capitals, punctuation, long values) may be free text.
const ENUM_SHAPE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/**
 * An enum property that is safe to display: null when absent, the value when
 * it has an enum's shape, otherwise `other`. The raw value is never returned.
 */
export function enumValue(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return typeof raw === 'string' && ENUM_SHAPE.test(raw) ? raw : OTHER_BUCKET;
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function intentBucket(raw: unknown): string {
  const value = enumValue(raw);
  if (value === null || value === 'none') return LEGACY_BUCKET;
  return isOneOf(CHAT_STARTER_INTENTS, value) ? value : OTHER_BUCKET;
}

/** The 0-based slot_index as a row key. */
export function slotBucket(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return LEGACY_BUCKET;
  const slot =
    typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(slot) && slot >= 0 && slot < 100 ? String(slot) : OTHER_BUCKET;
}

export function bundleAgeBucket(raw: unknown): string {
  const value = enumValue(raw);
  if (value === null) return LEGACY_BUCKET;
  return isOneOf(CHAT_STARTER_BUNDLE_AGES, value) ? value : OTHER_BUCKET;
}

type CardStep = 'shown' | 'tapped' | 'draftSent' | 'followups' | 'notInterested';
type CardCounts = Record<CardStep, number>;

const CARD_STEPS = new Map<string, CardStep>([
  [SHOWN_EVENT, 'shown'],
  [TAPPED_EVENT, 'tapped'],
  [DRAFT_SENT_EVENT, 'draftSent'],
  [FOLLOWUP_EVENT, 'followups'],
  [NOT_INTERESTED_EVENT, 'notInterested'],
]);

function emptyCounts(): CardCounts {
  return { shown: 0, tapped: 0, draftSent: 0, followups: 0, notInterested: 0 };
}

function bumpRow(rows: Map<string, CardCounts>, key: string, step: CardStep): void {
  let counts = rows.get(key);
  if (!counts) {
    counts = emptyCounts();
    rows.set(key, counts);
  }
  counts[step]++;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function isPersonalized(event: MixpanelEvent): boolean {
  const value = event.properties.personalized;
  return value === true || value === 'true';
}

/**
 * Follow-ups per starter conversation: Followup ÷ Draft_Sent, or Followup ÷
 * Tapped when there is no Draft_Sent to divide by.
 */
export function followupRate(
  counts: Pick<CardCounts, 'tapped' | 'draftSent' | 'followups'>,
): { rate: number; basis: 'draft_sent' | 'tapped' } {
  return counts.draftSent > 0
    ? { rate: safeDiv(counts.followups, counts.draftSent), basis: 'draft_sent' }
    : { rate: safeDiv(counts.followups, counts.tapped), basis: 'tapped' };
}

function rateRow(key: string, counts: CardCounts, totalShown: number): ChatStarterRateRow {
  const followup = followupRate(counts);
  return {
    key,
    ...counts,
    tapThrough: safeDiv(counts.tapped, counts.shown),
    followupRate: followup.rate,
    followupBasis: followup.basis,
    notInterestedRate: safeDiv(counts.notInterested, counts.shown),
    shareOfShown: safeDiv(counts.shown, totalShown),
  };
}

/** `other`, then `none (legacy)`, always sort after the real values. */
function tailRank(key: string): number {
  if (key === LEGACY_BUCKET) return 2;
  if (key === OTHER_BUCKET) return 1;
  return 0;
}

function toRateRows(
  rows: Map<string, CardCounts>,
  compare: (a: string, b: string) => number,
): ChatStarterRateRow[] {
  let totalShown = 0;
  for (const counts of rows.values()) totalShown += counts.shown;
  return Array.from(rows.keys())
    .sort((a, b) => tailRank(a) - tailRank(b) || compare(a, b))
    .map((key) => rateRow(key, rows.get(key)!, totalShown));
}

const inOrder = (order: readonly string[]) => (a: string, b: string) => order.indexOf(a) - order.indexOf(b);
const numerically = (a: string, b: string) => Number(a) - Number(b);

/** Best tap-through first (ties: more shown), capped; `other` and legacy rows last. */
function rankGenericCards(rows: Map<string, CardCounts>): ChatStarterRateRow[] {
  const all = toRateRows(rows, (a, b) => a.localeCompare(b));
  const ranked = all
    .filter((row) => tailRank(row.key) === 0)
    .sort((a, b) => b.tapThrough - a.tapThrough || b.shown - a.shown || a.key.localeCompare(b.key))
    .slice(0, TOP_GENERIC_LIMIT);
  return [...ranked, ...all.filter((row) => tailRank(row.key) > 0)];
}

function toNameValue(counts: Map<string, number>): { name: string; value: number }[] {
  return Array.from(counts, ([name, value]) => ({ name, value })).sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
}

interface PlatformCounts {
  personalizedShown: number;
  personalizedTapped: number;
  genericShown: number;
  genericTapped: number;
}

function platformRows(byPlatform: Map<string, PlatformCounts>): ChatStarterPlatformRow[] {
  return Array.from(byPlatform.keys())
    .sort((a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b))
    .map((platform) => {
      const c = byPlatform.get(platform)!;
      return {
        platform,
        personalizedShown: c.personalizedShown,
        personalizedTapped: c.personalizedTapped,
        personalizedTapThrough: safeDiv(c.personalizedTapped, c.personalizedShown),
        genericShown: c.genericShown,
        genericTapped: c.genericTapped,
        genericTapThrough: safeDiv(c.genericTapped, c.genericShown),
      };
    });
}

/**
 * Narrow an export to the dashboard's platform and user-type filters, then to
 * the starter events. User type is classified before the signup/purchase
 * context events are dropped.
 */
export function scopeChatStarterEvents(
  events: MixpanelEvent[],
  platform: string,
  userType: UserType,
): MixpanelEvent[] {
  return filterEventsByType(filterByUserType(filterByPlatform(events, platform), userType), CHAT_STARTER_EVENTS);
}

export interface ChatStartersContext {
  dateRange: DateRange;
  platform: string;
  userType: UserType;
  /** The export's status; dataUnavailable means the zeros are not real. */
  fetch: Pick<MixpanelFetchResult, 'dataUnavailable' | 'servedStale' | 'fetchedAt'>;
  lastUpdated: string;
}

export function buildChatStartersMetrics(
  rawEvents: MixpanelEvent[],
  context: ChatStartersContext,
): ChatStartersMetrics {
  const events = scopeChatStarterEvents(rawEvents, context.platform, context.userType);

  const personalized = emptyCounts();
  const viewers = new Set<string>();
  const byIntent = new Map<string, CardCounts>();
  const bySlot = new Map<string, CardCounts>();
  const byBundleAge = new Map<string, CardCounts>();
  const genericCards = new Map<string, CardCounts>();
  const byPlatform = new Map<string, PlatformCounts>();
  const statuses = new Map<string, number>();
  const firstPaints = new Map<string, number>();
  const validationReasons = new Map<string, number>();
  let fetches = 0;
  let whyOpened = 0;
  let moreTapped = 0;
  let validationFailed = 0;

  for (const event of events) {
    const name = normalizeEventName(event.event);
    const p = event.properties;
    const step = CARD_STEPS.get(name);

    if (step) {
      const personal = isPersonalized(event);
      if (step === 'shown' || step === 'tapped') {
        const platform = platformOf(event);
        let counts = byPlatform.get(platform);
        if (!counts) {
          counts = { personalizedShown: 0, personalizedTapped: 0, genericShown: 0, genericTapped: 0 };
          byPlatform.set(platform, counts);
        }
        if (personal) counts[step === 'shown' ? 'personalizedShown' : 'personalizedTapped']++;
        else counts[step === 'shown' ? 'genericShown' : 'genericTapped']++;
      }
      if (personal) {
        personalized[step]++;
        if (step === 'shown' && p.distinct_id) viewers.add(p.distinct_id);
        bumpRow(byIntent, intentBucket(p.intent), step);
        bumpRow(bySlot, slotBucket(p.slot_index), step);
        bumpRow(byBundleAge, bundleAgeBucket(p.bundle_age), step);
      } else {
        bumpRow(genericCards, enumValue(p.generic_id) ?? LEGACY_BUCKET, step);
      }
      continue;
    }

    switch (name) {
      case FETCHED_EVENT: {
        fetches++;
        bump(statuses, enumValue(p.status) ?? UNKNOWN_BUCKET);
        const firstPaint = enumValue(p.first_paint);
        if (firstPaint !== null) bump(firstPaints, firstPaint);
        break;
      }
      case WHY_OPENED_EVENT:
        whyOpened++;
        break;
      case MORE_TAPPED_EVENT:
        moreTapped++;
        break;
      case VALIDATION_FAILED_EVENT:
        validationFailed++;
        bump(validationReasons, enumValue(p.reason) ?? UNKNOWN_BUCKET);
        break;
    }
  }

  const followup = followupRate(personalized);
  let firstPaintFetches = 0;
  for (const count of firstPaints.values()) firstPaintFetches += count;
  const skeletonTimeouts = firstPaints.get('generic_timeout') ?? 0;

  return {
    cardsShown: personalized.shown,
    uniqueViewers: viewers.size,
    tapped: personalized.tapped,
    draftSent: personalized.draftSent,
    followups: personalized.followups,
    notInterested: personalized.notInterested,
    tapThrough: safeDiv(personalized.tapped, personalized.shown),
    followupRate: followup.rate,
    followupBasis: followup.basis,
    notInterestedRate: safeDiv(personalized.notInterested, personalized.shown),
    funnel: buildFunnel([
      { name: 'Shown', count: personalized.shown },
      { name: 'Tapped', count: personalized.tapped },
      { name: 'Sent', count: personalized.draftSent },
      { name: 'Followed up', count: personalized.followups },
    ]),
    byIntent: toRateRows(byIntent, inOrder(CHAT_STARTER_INTENTS)),
    bySlot: toRateRows(bySlot, numerically),
    byBundleAge: toRateRows(byBundleAge, inOrder(CHAT_STARTER_BUNDLE_AGES)),
    fetches,
    fetchStatuses: toNameValue(statuses),
    firstPaints: toNameValue(firstPaints),
    firstPaintFetches,
    skeletonTimeouts,
    skeletonTimeoutRate: safeDiv(skeletonTimeouts, firstPaintFetches),
    byPlatform: platformRows(byPlatform),
    topGenericCards: rankGenericCards(genericCards),
    whyOpened,
    moreTapped,
    validationFailed,
    validationFailedByReason: toNameValue(validationReasons),
    dateRange: context.dateRange,
    platform: context.platform,
    userType: context.userType,
    dataUnavailable: context.fetch.dataUnavailable,
    servedStale: context.fetch.servedStale,
    dataAsOf: context.fetch.fetchedAt,
    lastUpdated: context.lastUpdated,
  };
}
