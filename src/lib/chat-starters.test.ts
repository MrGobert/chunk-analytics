import { describe, expect, it } from 'vitest';
import {
  buildChatStartersMetrics,
  CHAT_STARTER_EVENTS,
  enumValue,
  LEGACY_BUCKET,
  OTHER_BUCKET,
  type ChatStartersContext,
} from '@/lib/chat-starters';
import type { ChatStarterRateRow, MixpanelEvent } from '@/types/mixpanel';

const DAY = '2026-09-27';
const IOS = { platform: 'iOS', $os: 'iOS' };

function event(name: string, uid: string, properties: Record<string, unknown> = {}): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: Date.parse(`${DAY}T12:00:00Z`) / 1000,
      distinct_id: uid,
      $user_id: uid,
      platform: 'web',
      ...properties,
    },
  };
}

/** A personalized card event; pre-v2 unless v2 props are passed. */
const personal = (step: string, uid: string, props: Record<string, unknown> = {}) =>
  event(`Chat_Starter_${step}`, uid, { kind: 'continue', personalized: true, launch: 'send', ...props });

const generic = (step: string, uid: string, props: Record<string, unknown> = {}) =>
  event(`Chat_Starter_${step}`, uid, { kind: 'generic', personalized: false, launch: 'draft', intent: 'generic', ...props });

function build(events: MixpanelEvent[], overrides: Partial<ChatStartersContext> = {}) {
  return buildChatStartersMetrics(events, {
    dateRange: { from: '2026-09-21', to: DAY },
    platform: 'all',
    userType: 'all',
    fetch: { dataUnavailable: false, servedStale: false, fetchedAt: '2026-09-27T12:30:00Z' },
    lastUpdated: '2026-09-27T12:31:00Z',
    ...overrides,
  });
}

const row = (rows: ChatStarterRateRow[], key: string) => rows.find((r) => r.key === key)!;

/** Every number in a payload, however deeply nested. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

describe('buildChatStartersMetrics', () => {
  it('computes the personalized headline rates and funnel, leaving generic cards out', () => {
    const m = build([
      personal('Shown', 'a'),
      personal('Shown', 'a'),
      personal('Shown', 'b'),
      personal('Shown', 'b'),
      personal('Tapped', 'a'),
      personal('Tapped', 'b'),
      personal('Draft_Sent', 'a'),
      personal('Draft_Sent', 'b'),
      personal('Followup', 'a'),
      personal('Not_Interested', 'b'),
      generic('Shown', 'c', { generic_id: 'quiz-me' }),
      generic('Tapped', 'c', { generic_id: 'quiz-me' }),
      generic('Draft_Sent', 'c', { generic_id: 'quiz-me' }),
    ]);

    expect(m).toMatchObject({
      cardsShown: 4,
      uniqueViewers: 2,
      tapped: 2,
      draftSent: 2,
      followups: 1,
      notInterested: 1,
      tapThrough: 0.5,
      followupRate: 0.5,
      followupBasis: 'draft_sent',
      notInterestedRate: 0.25,
    });
    expect(m.funnel.map((s) => [s.name, s.count, s.percentage])).toEqual([
      ['Shown', 4, 100],
      ['Tapped', 2, 50],
      ['Sent', 2, 50],
      ['Followed up', 1, 25],
    ]);
  });

  it('reports rates by intent, with intent-less cards in none (legacy) so history spans the change', () => {
    const m = build([
      // Older clients send no intent at all.
      personal('Shown', 'old'),
      personal('Shown', 'old'),
      personal('Shown', 'old'),
      personal('Shown', 'old'),
      personal('Tapped', 'old'),
      // A v2 card the server sent without an intent joins them.
      personal('Shown', 'new', { intent: 'none' }),
      personal('Shown', 'new', { intent: 'resume' }),
      personal('Shown', 'new', { intent: 'resume' }),
      personal('Tapped', 'new', { intent: 'resume' }),
      personal('Draft_Sent', 'new', { intent: 'resume' }),
      personal('Followup', 'new', { intent: 'resume' }),
      personal('Shown', 'new', { intent: 'explore', kind: 'explore' }),
      personal('Not_Interested', 'new', { intent: 'explore', kind: 'explore' }),
      personal('Shown', 'new', { intent: 'whats_new', kind: 'explore' }),
      personal('Shown', 'new', { intent: 'a brand new intent' }),
    ]);

    // Contract order, then other, then legacy last.
    expect(m.byIntent.map((r) => r.key)).toEqual(['resume', 'whats_new', 'explore', OTHER_BUCKET, LEGACY_BUCKET]);
    expect(row(m.byIntent, 'resume')).toMatchObject({
      shown: 2,
      tapped: 1,
      draftSent: 1,
      followups: 1,
      tapThrough: 0.5,
      followupRate: 1,
      followupBasis: 'draft_sent',
      notInterestedRate: 0,
      shareOfShown: 0.2,
    });
    expect(row(m.byIntent, 'explore')).toMatchObject({ shown: 1, tapped: 0, tapThrough: 0, notInterested: 1, notInterestedRate: 1 });
    expect(row(m.byIntent, LEGACY_BUCKET)).toMatchObject({ shown: 5, tapped: 1, tapThrough: 0.2, shareOfShown: 0.5 });
    // The rows partition the headline.
    expect(m.byIntent.reduce((sum, r) => sum + r.shown, 0)).toBe(m.cardsShown);
    expect(m.byIntent.reduce((sum, r) => sum + r.tapped, 0)).toBe(m.tapped);
  });

  it('builds the slot table in position order with legacy last, and bundle age youngest first', () => {
    const m = build([
      personal('Shown', 'a', { slot_index: 0, bundle_age: 'lt_1h' }),
      personal('Shown', 'b', { slot_index: 0, bundle_age: 'lt_1h' }),
      personal('Tapped', 'a', { slot_index: 0, bundle_age: 'lt_1h' }),
      personal('Shown', 'a', { slot_index: 1, bundle_age: '6h_24h' }),
      personal('Shown', 'b', { slot_index: 1, bundle_age: '6h_24h' }),
      personal('Tapped', 'b', { slot_index: 1, bundle_age: '6h_24h' }),
      personal('Not_Interested', 'a', { slot_index: 1, bundle_age: '6h_24h' }),
      personal('Shown', 'a', { slot_index: 10, bundle_age: 'gt_3d' }),
      personal('Shown', 'a', { slot_index: '2', bundle_age: '1h_6h' }),
      personal('Shown', 'a', { slot_index: 2, bundle_age: '1h_6h' }),
      personal('Shown', 'a', { slot_index: -1, bundle_age: 'someday' }),
      personal('Shown', 'old'),
    ]);

    // Numeric, not string, order: 10 comes after 2.
    expect(m.bySlot.map((r) => r.key)).toEqual(['0', '1', '2', '10', OTHER_BUCKET, LEGACY_BUCKET]);
    expect(row(m.bySlot, '0')).toMatchObject({ shown: 2, tapped: 1, tapThrough: 0.5, notInterestedRate: 0 });
    expect(row(m.bySlot, '1')).toMatchObject({ shown: 2, tapped: 1, tapThrough: 0.5, notInterested: 1, notInterestedRate: 0.5 });
    expect(row(m.bySlot, '2')).toMatchObject({ shown: 2, tapped: 0, tapThrough: 0 });
    expect(row(m.bySlot, LEGACY_BUCKET)).toMatchObject({ shown: 1 });
    expect(m.bySlot.map((r) => r.shareOfShown)).toEqual([2 / 9, 2 / 9, 2 / 9, 1 / 9, 1 / 9, 1 / 9]);

    expect(m.byBundleAge.map((r) => r.key)).toEqual(['lt_1h', '1h_6h', '6h_24h', 'gt_3d', OTHER_BUCKET, LEGACY_BUCKET]);
    expect(row(m.byBundleAge, 'lt_1h')).toMatchObject({ shown: 2, tapped: 1, tapThrough: 0.5 });
  });

  it('falls back to Followup ÷ Tapped when there is no Draft_Sent', () => {
    const m = build([
      personal('Shown', 'a'),
      personal('Shown', 'a'),
      personal('Shown', 'a'),
      personal('Shown', 'a'),
      personal('Tapped', 'a'),
      personal('Tapped', 'a'),
      personal('Followup', 'a'),
    ]);

    expect(m).toMatchObject({ followupRate: 0.5, followupBasis: 'tapped' });
    expect(row(m.byIntent, LEGACY_BUCKET)).toMatchObject({ followupRate: 0.5, followupBasis: 'tapped' });
  });

  it('never divides by zero: every rate is a finite number, 0 without a denominator', () => {
    const empty = build([]);
    expect(empty).toMatchObject({
      cardsShown: 0,
      tapThrough: 0,
      followupRate: 0,
      notInterestedRate: 0,
      skeletonTimeoutRate: 0,
    });
    expect(empty.funnel.map((s) => [s.count, s.percentage, s.dropoff])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);

    // Taps and follow-ups whose Shown fell before the window; a fetch with no first paint.
    const orphans = build([
      personal('Tapped', 'a', { slot_index: 0 }),
      personal('Followup', 'a', { slot_index: 0 }),
      generic('Not_Interested', 'b', { generic_id: 'chart' }),
      event('Chat_Starter_Fetched', 'a', { status: 'ready', trigger: 'poll' }),
    ]);
    expect(orphans).toMatchObject({ cardsShown: 0, tapThrough: 0, notInterestedRate: 0, skeletonTimeoutRate: 0 });
    expect(row(orphans.bySlot, '0')).toMatchObject({ shown: 0, tapThrough: 0, notInterestedRate: 0, shareOfShown: 0 });
    expect(row(orphans.topGenericCards, 'chart')).toMatchObject({ shown: 0, tapThrough: 0, followupRate: 0 });
    expect(orphans.byPlatform).toEqual([
      {
        platform: 'Web',
        personalizedShown: 0,
        personalizedTapped: 1,
        personalizedTapThrough: 0,
        genericShown: 0,
        genericTapped: 0,
        genericTapThrough: 0,
      },
    ]);

    for (const m of [empty, orphans]) {
      for (const n of numbersIn(m)) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('flags an unavailable export and returns an all-zero, empty payload', () => {
    const m = build([], { fetch: { dataUnavailable: true, servedStale: false, fetchedAt: null } });

    expect(m).toMatchObject({
      dataUnavailable: true,
      servedStale: false,
      dataAsOf: null,
      cardsShown: 0,
      uniqueViewers: 0,
      fetches: 0,
      whyOpened: 0,
      moreTapped: 0,
      validationFailed: 0,
      lastUpdated: '2026-09-27T12:31:00Z',
    });
    for (const list of [
      m.byIntent,
      m.bySlot,
      m.byBundleAge,
      m.byPlatform,
      m.topGenericCards,
      m.fetchStatuses,
      m.firstPaints,
      m.validationFailedByReason,
    ]) {
      expect(list).toEqual([]);
    }
    expect(m.funnel.every((s) => s.count === 0 && s.percentage === 0)).toBe(true);

    // A stale snapshot is real data, flagged so the page can say how old it is.
    const stale = build([personal('Shown', 'a')], {
      fetch: { dataUnavailable: false, servedStale: true, fetchedAt: '2026-09-27T09:00:00Z' },
    });
    expect(stale).toMatchObject({ dataUnavailable: false, servedStale: true, dataAsOf: '2026-09-27T09:00:00Z', cardsShown: 1 });
  });

  it('breaks down fetch statuses and the skeleton-timeout rate among fetches with first_paint', () => {
    const fetched = (props: Record<string, unknown>) =>
      event('Chat_Starter_Fetched', 'a', { trigger: 'mount', suggestion_count: 4, refresh_pending: false, ...props });
    const m = build([
      fetched({ status: 'ready', first_paint: 'cached' }),
      fetched({ status: 'ready', first_paint: 'generic_timeout' }),
      fetched({ status: 'ready', trigger: 'poll' }),
      fetched({ status: 'generation_queued', first_paint: 'generic_timeout' }),
      fetched({ status: 'daily_cap', first_paint: 'generic_empty' }),
      fetched({}),
    ]);

    expect(m.fetches).toBe(6);
    expect(m.fetchStatuses).toEqual([
      { name: 'ready', value: 3 },
      { name: 'daily_cap', value: 1 },
      { name: 'generation_queued', value: 1 },
      { name: 'unknown', value: 1 },
    ]);
    expect(m).toMatchObject({ firstPaintFetches: 4, skeletonTimeouts: 2, skeletonTimeoutRate: 0.5 });
    expect(m.firstPaints).toEqual([
      { name: 'generic_timeout', value: 2 },
      { name: 'cached', value: 1 },
      { name: 'generic_empty', value: 1 },
    ]);
  });

  it('compares personalized and generic tap-through by platform and ranks generic cards', () => {
    const m = build([
      personal('Shown', 'a'),
      personal('Shown', 'a'),
      personal('Tapped', 'a'),
      personal('Shown', 'b', IOS),
      personal('Tapped', 'b', IOS),
      generic('Shown', 'c', { generic_id: 'quiz-me' }),
      generic('Shown', 'c', { generic_id: 'quiz-me' }),
      generic('Tapped', 'c', { generic_id: 'quiz-me' }),
      generic('Draft_Sent', 'c', { generic_id: 'quiz-me' }),
      generic('Shown', 'c', { generic_id: 'chart' }),
      generic('Tapped', 'c', { generic_id: 'chart' }),
      generic('Shown', 'd', { ...IOS, generic_id: 'image' }),
      generic('Shown', 'd', { ...IOS, generic_id: 'research-report' }),
      generic('Shown', 'd', { ...IOS, generic_id: 'research-report' }),
      generic('Tapped', 'd', { ...IOS, generic_id: 'research-report' }),
      // The retired neutral pair: not personalized, no generic_id.
      event('Chat_Starter_Shown', 'e', { kind: 'continue', personalized: false, launch: 'draft' }),
      event('Chat_Starter_Tapped', 'e', { kind: 'continue', personalized: false, launch: 'draft' }),
    ]);

    expect(m.byPlatform).toEqual([
      {
        platform: 'Web',
        personalizedShown: 2,
        personalizedTapped: 1,
        personalizedTapThrough: 0.5,
        genericShown: 4,
        genericTapped: 3,
        genericTapThrough: 0.75,
      },
      {
        platform: 'iOS',
        personalizedShown: 1,
        personalizedTapped: 1,
        personalizedTapThrough: 1,
        genericShown: 3,
        genericTapped: 1,
        genericTapThrough: 1 / 3,
      },
    ]);
    // Best tap-through first; ties go to more shown, then the id. Legacy last.
    expect(m.topGenericCards.map((r) => [r.key, r.shown, r.tapThrough])).toEqual([
      ['chart', 1, 1],
      ['quiz-me', 2, 0.5],
      ['research-report', 2, 0.5],
      ['image', 1, 0],
      [LEGACY_BUCKET, 1, 1],
    ]);
    expect(row(m.topGenericCards, 'quiz-me').draftSent).toBe(1);
    expect(m.cardsShown).toBe(3);
  });

  it('counts Why_Opened, More_Tapped and Validation_Failed (by reason) apart from the card metrics', () => {
    const m = build([
      event('Chat_Starter_Why_Opened', 'a', { intent: 'resume', source_kind: 'conversation', discreet: false, has_why: true, slot_index: 0 }),
      event('Chat_Starter_More_Tapped', 'a', { page_index: 0, page_count: 2, card_count: 4, personalized: true }),
      event('Chat_Starter_More_Tapped', 'a', { page_index: 1, page_count: 2, card_count: 4, personalized: true }),
      event('Chat_Starter_Validation_Failed', 'a', { reason: 'changed', stage: 'preflight', launch: 'send' }),
      event('Chat_Starter_Validation_Failed', 'a', { reason: 'changed', stage: 'stream', launch: 'send' }),
      event('Chat_Starter_Validation_Failed', 'a', { reason: 'unavailable', stage: 'preflight', launch: 'send' }),
    ]);

    expect(m).toMatchObject({ whyOpened: 1, moreTapped: 2, validationFailed: 3, cardsShown: 0 });
    expect(m.validationFailedByReason).toEqual([
      { name: 'changed', value: 2 },
      { name: 'unavailable', value: 1 },
    ]);
    expect(m.byIntent).toEqual([]);
    expect(m.bySlot).toEqual([]);
  });

  it('never echoes a value that is not enum-shaped', () => {
    expect(enumValue('generic_timeout')).toBe('generic_timeout');
    expect(enumValue('research-report')).toBe('research-report');
    expect(enumValue(undefined)).toBeNull();
    expect(enumValue('')).toBeNull();
    expect(enumValue('What do my documents say about taxes?')).toBe(OTHER_BUCKET);
    expect(enumValue('Ready')).toBe(OTHER_BUCKET);
    expect(enumValue(42)).toBe(OTHER_BUCKET);

    const m = build([
      generic('Shown', 'a', { generic_id: 'Summarize this YouTube video: https://example.com' }),
      event('Chat_Starter_Fetched', 'a', { status: 'Error: connection reset by peer', first_paint: 'cached' }),
      event('Chat_Starter_Validation_Failed', 'a', { reason: 'The earlier context changed' }),
    ]);
    expect(m.topGenericCards.map((r) => r.key)).toEqual([OTHER_BUCKET]);
    expect(m.fetchStatuses).toEqual([{ name: OTHER_BUCKET, value: 1 }]);
    expect(m.validationFailedByReason).toEqual([{ name: OTHER_BUCKET, value: 1 }]);
    expect(JSON.stringify(m)).not.toMatch(/YouTube|connection reset|earlier context/);
  });

  it('applies the platform and user-type filters, classifying users before dropping context events', () => {
    const events = [
      personal('Shown', 'web-user'),
      personal('Shown', 'ios-subscriber', IOS),
      personal('Tapped', 'ios-subscriber', IOS),
      event('Purchase_Completed', 'ios-subscriber', IOS),
      event('Search_Performed', 'web-user'),
    ];

    expect(build(events, { platform: 'iOS' })).toMatchObject({ cardsShown: 1, tapped: 1, platform: 'iOS' });
    expect(build(events, { platform: 'web' })).toMatchObject({ cardsShown: 1, tapped: 0 });
    expect(build(events, { userType: 'subscribers' })).toMatchObject({ cardsShown: 1, tapped: 1, uniqueViewers: 1 });
    expect(build(events, { userType: 'visitors' })).toMatchObject({ cardsShown: 0 });
    expect(CHAT_STARTER_EVENTS).toHaveLength(9);
  });
});
