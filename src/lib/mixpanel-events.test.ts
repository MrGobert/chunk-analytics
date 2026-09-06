import { describe, expect, it } from 'vitest';
import type { MixpanelEvent } from '@/types/mixpanel';
import { deduplicateMixpanelEvents } from './mixpanel-events';

function event(properties: Partial<MixpanelEvent['properties']> = {}): MixpanelEvent {
  return {
    event: 'Search_Performed',
    properties: { distinct_id: 'customer', time: 1788220800, $insert_id: 'send-1', ...properties },
  };
}

describe('raw Mixpanel export deduplication', () => {
  it('counts five copies of a search once without mutating the export', () => {
    const original = event();
    const rows = Array.from({ length: 5 }, () => structuredClone(original));
    expect(deduplicateMixpanelEvents(rows)).toEqual([original]);
    expect(rows).toHaveLength(5);
  });

  it('keeps the latest ingestion even when the export arrives out of order', () => {
    const older = event({ $mp_api_timestamp_ms: 100, model_used: 'old' });
    const newer = event({ $mp_api_timestamp_ms: '200', model_used: 'new' });
    expect(deduplicateMixpanelEvents([newer, older])).toEqual([newer]);
    expect(deduplicateMixpanelEvents([older, newer])).toEqual([newer]);
  });

  it('uses processing time when the API timestamp is absent', () => {
    const newer = event({ mp_processing_time_ms: 200 });
    const older = event({ mp_processing_time_ms: 100 });
    expect(deduplicateMixpanelEvents([newer, older])).toEqual([newer]);
  });

  it('keeps the last version when ingestion times are unavailable', () => {
    const last = event({ has_context: true });
    expect(deduplicateMixpanelEvents([event(), last])).toEqual([last]);
  });

  it('keeps different users, times, raw event names, and insert IDs', () => {
    const rows = [
      event(),
      event({ distinct_id: 'another-customer' }),
      event({ time: 1788220801 }),
      { ...event(), event: 'Search Performed' },
      event({ $insert_id: 'send-2' }),
    ];
    expect(deduplicateMixpanelEvents(rows.flatMap((row) => [row, row]))).toEqual(rows);
  });

  it('does not guess whether native events with different IDs were one send', () => {
    const rows = [event({ platform: 'iOS' }), event({ platform: 'iOS', $insert_id: 'send-2' })];
    expect(deduplicateMixpanelEvents(rows)).toEqual(rows);
  });

  it.each([undefined, '', '   '])('preserves events with unusable insert ID %s', (insertId) => {
    const rows = [event({ $insert_id: insertId }), event({ $insert_id: insertId })];
    expect(deduplicateMixpanelEvents(rows)).toEqual(rows);
  });

  it('preserves incomplete identities and the order of unrelated rows', () => {
    const anonymous = event({ distinct_id: '' });
    const invalidTime = event({ time: Number.NaN });
    const rows = [event(), anonymous, anonymous, invalidTime, invalidTime, event()];
    expect(deduplicateMixpanelEvents(rows)).toEqual(rows.slice(0, -1));
  });
});
