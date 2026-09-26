import { describe, expect, it } from 'vitest';
import type { MixpanelEvent } from '@/types/mixpanel';
import { aggregateJourneyMetrics, deliveredJourneyValues, journeyAccountResolver, journeyObservationRange, orderedAccountCounts } from '@/lib/journey';
import { filterByPlatform, platformOf } from '@/lib/mixpanel';

const DAY = 86400;
const START = Date.parse('2026-07-01T12:00:00Z') / 1000;
const dateRange = { from: '2026-07-01', to: '2026-07-01' };
const event = (name: string, uid = 'account-1', offset = 0, props: Record<string, unknown> = {}): MixpanelEvent => ({
  event: name, properties: { distinct_id: uid, time: START + offset, platform: 'iOS', ...props },
});
const signup = (uid = 'account-1', offset = 0, props = {}) => event('Signup_Completed', uid, offset, props);
const value = (uid = 'account-1', offset = 60, props = {}) => event('Journey_Value_Completed', uid, offset, {
  value_id: `value-${offset}`, value_kind: 'chat', is_visible: true, journey_version: 1, ...props,
});
const aggregate = (events: MixpanelEvent[], observedThrough = START + 40 * DAY, platform = 'all') => aggregateJourneyMetrics(events, { dateRange, observedThrough, platform });

describe('successful native journey cohorts', () => {
  it('preserves the signup window but follows outcomes beyond its final date', () => {
    const data = aggregate([
      signup(), signup('outside', DAY),
      value('account-1', 23 * 3600),
      value('account-1', 6 * DAY, { value_kind: 'collection' }),
      value('account-1', 7.5 * DAY),
      event('Paywall_Viewed', 'account-1', 20 * DAY),
      event('Purchase_Completed', 'account-1', 29 * DAY, { is_trial: true }),
    ]);
    expect(data.signups).toBe(1);
    expect(data.successfulValueRate).toBe(1);
    expect(data.nonChatRate).toBe(1);
    expect(data.returnD7Rate).toBe(1);
    expect(data.funnel.map((step) => step.count)).toEqual([1, 1, 1, 1]);
    expect(data.clientCheckouts30d).toEqual({ trials: 1, nonTrial: 0, unknown: 0 });
  });

  it('right-censors each metric until its complete window is observed', () => {
    const events = [signup(), value(), value('account-1', 7.1 * DAY)];
    expect(aggregate(events, START + 0.5 * DAY).successfulValueRate).toBeNull();
    const sevenDays = aggregate(events, START + 7.5 * DAY);
    expect(sevenDays.eligible24h).toBe(1);
    expect(sevenDays.eligible7d).toBe(1);
    expect(sevenDays.eligibleD7).toBe(0);
    expect(sevenDays.returnD7Rate).toBeNull();
    expect(sevenDays.eligible30d).toBe(0);
    expect(sevenDays.funnel.every((step) => step.count === 0)).toBe(true);
    expect(aggregate(events, START + 8 * DAY).returnedD7).toBe(1);
  });

  it('does not mistake attempts, failed results, missing IDs, or empty work for value', () => {
    const data = aggregate([
      signup(), event('Search_Performed'), event('Collection_Created'), event('Research_Report_Initiated'),
      value('account-1', 1, { status: 'failed' }), value('account-1', 2, { is_empty: true }),
      value('account-1', 3, { success: false }), value('account-1', 4, { value_id: '' }),
      value('account-1', 5, { value_kind: 'unknown' }), value('account-1', 6, { is_visible: undefined }),
    ]);
    expect(data.successful24h).toBe(0);
    expect(data.medianMinutesToValue).toBeNull();
  });

  it('counts background work only when a matching completed outcome is viewed', () => {
    const data = aggregate([
      signup(), value('account-1', 30, { is_visible: false, value_id: 'siri-result', value_kind: 'siri' }),
      event('Journey_Value_Viewed', 'account-1', 45, { value_id: 'wrong' }),
      event('Journey_Value_Viewed', 'other-user', 60, { value_id: 'siri-result' }),
      event('Journey_Value_Viewed', 'account-1', 120, { value_id: 'siri-result' }),
      event('Journey_Value_Viewed', 'account-1', 180, { value_id: 'siri-result' }),
    ]);
    expect(data.successful24h).toBe(1);
    expect(data.medianMinutesToValue).toBe(2);
    expect(aggregate([signup(), value('account-1', 30, { is_visible: false })]).successful24h).toBe(0);
  });

  it('handles duplicates and shuffled same-second completion/viewed exports once', () => {
    const complete = value('account-1', 60, { is_visible: false, $insert_id: 'complete' });
    const viewed = event('Journey_Value_Viewed', 'account-1', 60, { value_id: 'value-60' });
    expect(deliveredJourneyValues([viewed, complete, complete, viewed])).toEqual([{ time: START + 60, kind: 'chat', id: 'value-60' }]);
  });

  it('counts one delivered object when generic and Shortcuts result telemetry both describe it', () => {
    const values = deliveredJourneyValues([
      value('account-1', 30, { value_kind: 'note', value_id: 'note-1' }),
      value('account-1', 20, { value_kind: 'shortcuts', value_id: 'note:note-1', is_visible: false }),
      event('Journey_Value_Viewed', 'account-1', 30, { value_kind: 'shortcuts', value_id: 'note:note-1' }),
    ]);
    expect(values).toHaveLength(1);
    expect(values[0].time).toBe(START + 30);
  });

  it('deduplicates signups, links accounts across devices and attributes to signup device', () => {
    const data = aggregate([
      signup('old-distinct', 0, { account_id: 'shared-account', device_family: 'iPad', platform: 'iOS' }),
      event('onboarding_v2_account_created', 'account-2', 5, { account_id: 'shared-account', platform: 'macOS' }),
      value('mac-distinct', 30, { account_id: 'shared-account', platform: 'macOS' }),
    ], START + 40 * DAY, 'iPadOS');
    expect(data.signups).toBe(1);
    expect(data.successful24h).toBe(1);
    expect(data.byPlatform[0].name).toBe('iPadOS');
    expect(data.byDeviceFamily[0].name).toBe('iPad');
  });

  it('keeps all native platforms separate and excludes web', () => {
    const events = ['iOS', 'iPadOS', 'macOS', 'visionOS', 'web'].flatMap((platform) => [
      signup(platform, 0, { platform }), value(platform, 60, { platform }),
    ]);
    expect(aggregate(events).signups).toBe(4);
    for (const platform of ['iOS', 'iPadOS', 'macOS', 'visionOS']) expect(aggregate(events, START + 40 * DAY, platform).successful24h).toBe(1);
  });

  it('requires ordered same-account funnel stages and retains each paywall source', () => {
    const data = aggregate([
      signup('new'), value('new', 60), event('Paywall_Viewed', 'new', 120, { source: 'onboarding_first_value' }),
      event('Paywall_Dismissed', 'new', 180, { source: 'onboarding_first_value' }),
      event('Purchase_Completed', 'new', 240, { source: 'onboarding_first_value', is_trial: false }),
      signup('legacy'), event('Paywall_Viewed', 'legacy', 20, { source: 'automatic_first_query' }),
      event('Purchase_Completed', 'legacy', 30, { source: 'automatic_first_query' }), value('legacy', 40),
      event('Purchase_Completed', 'unrelated', 360),
    ]);
    expect(data.funnel.map((step) => step.count)).toEqual([2, 2, 1, 1]);
    expect(data.paywallSources).toContainEqual({ source: 'onboarding_first_value', viewed: 1, dismissed: 1, checkouts: 1 });
    expect(data.paywallSources).toContainEqual({ source: 'automatic_first_query', viewed: 1, dismissed: 0, checkouts: 1 });
    expect(data.clientCheckouts30d).toEqual({ trials: 0, nonTrial: 1, unknown: 1 });
    expect(data.paidConversion30d).toBeNull();
    expect(data.revenuePerNewAccount30d).toBeNull();
  });

  it('excludes out-of-order and post-window outcomes, and separates journey versions', () => {
    const data = aggregate([
      signup('a', 0, { journey_version: 1 }), value('a', -60), value('a', DAY + 1),
      event('Purchase_Completed', 'a', 30 * DAY + 1),
      signup('b'), event('Search_Performed', 'b', 60),
    ]);
    expect(data.successful24h).toBe(0);
    expect(data.clientCheckouts30d.unknown).toBe(0);
    expect(data.byJourneyVersion.map((row) => row.name)).toEqual(['1', 'legacy']);
  });

  it('counts tour exposure and task selection per account, with no inferred success', () => {
    const data = aggregate([signup(), event('Journey_Tour_Viewed'), event('Journey_Tour_Viewed'),
      event('Journey_Tour_Page_Viewed', 'account-1', 1, { page: 'collections' }),
      event('Journey_Tour_Action_Selected', 'account-1', 2, { destination: 'collection' }),
      event('Journey_Tour_Dismissed', 'account-1', 3)]);
    expect(data.tour).toEqual({ viewed: 1, dismissed: 1, actions: [{ name: 'collection', accounts: 1 }], pages: [{ name: 'collections', accounts: 1 }] });
    expect(data.successful24h).toBe(0);
  });

  it('excludes uninstrumented legacy signups without turning missing tracking into failed value', () => {
    const data = aggregate([signup('legacy'), signup('new', 0, { journey_version: 1 })]);
    expect(data.signups).toBe(2);
    expect(data.instrumentedSignups).toBe(1);
    expect(data.eligible24h).toBe(1);
    expect(data.byJourneyVersion.find((row) => row.name === 'legacy')!.successfulValueRate).toBeNull();
    expect(data.funnel[0].count).toBe(1);
  });
});

describe('native identity and observation boundaries', () => {
  it('links explicit identify events without joining two accounts on a shared device', () => {
    const events = [event('onboarding_v2_started', 'anonymous'),
      event('$identify', 'account-1', 1, { $identified_id: 'account-1', $anon_id: 'anonymous' }),
      signup('account-1', 2, { $device_id: 'shared-device' }),
      signup('account-2', 3, { $device_id: 'shared-device' })];
    const accountOf = journeyAccountResolver(events);
    expect(accountOf(events[0])).toBe('account-1');
    expect(accountOf(events[2])).toBe('account-1');
    expect(accountOf(events[3])).toBe('account-2');
    expect(orderedAccountCounts([
      { name: 'start', events: [events[0]] }, { name: 'signup', events: events.slice(2) },
      { name: 'value', events: [value('account-2', 10)] },
    ], accountOf).map((step) => step.count)).toEqual([1, 1, 0]);
  });

  it('refuses ambiguous anonymous identity links', () => {
    const events = [event('start', 'anonymous'),
      event('$identify', 'a', 1, { $identified_id: 'a', $anon_id: 'anonymous' }),
      event('$identify', 'b', 2, { $identified_id: 'b', $anon_id: 'anonymous' })];
    expect(journeyAccountResolver(events)(events[0])).toBe('anonymous');
  });

  it('extends historical cohort exports 30 days and caps current exports at now', () => {
    const past = journeyObservationRange(dateRange, START + 100 * DAY);
    expect(past.to).toBe('2026-07-31');
    expect(past.through).toBe(Date.parse('2026-08-01T00:00:00Z') / 1000);
    const recent = journeyObservationRange(dateRange, START + 3 * DAY);
    expect(recent.to).toBe('2026-07-04');
    expect(recent.through).toBe(START + 3 * DAY);
  });

  it('detects iPad native metadata while preserving the legacy global iOS umbrella', () => {
    const events = [event('x', 'phone'), event('x', 'tablet', 0, { $os: 'iOS', device_family: 'iPad' }),
      event('x', 'model', 0, { $model: 'iPad16,4' }), event('x', 'vision', 0, { platform: 'visionOS' })];
    expect(events.map(platformOf)).toEqual(['iOS', 'iPadOS', 'iPadOS', 'visionOS']);
    expect(filterByPlatform(events, 'iPadOS').length).toBe(2);
    expect(filterByPlatform(events, 'iOS').length).toBe(3);
  });
});
