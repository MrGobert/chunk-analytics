import { describe, expect, it } from 'vitest';
import { buildSequentialFunnel } from '@/lib/mixpanel';
import type { MixpanelEvent } from '@/types/mixpanel';

function event(name: string, uid: string): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: new Date('2026-07-01T20:00:00Z').getTime() / 1000,
      distinct_id: uid,
      platform: 'web',
    },
  };
}

const NOTES_STEPS = [
  { name: 'Created', eventName: 'Note_Created' },
  { name: 'Saved', eventName: 'Note_Saved' },
  { name: 'Published', eventName: 'Note_Published' },
  { name: 'Shared', eventName: 'Note_Shared' },
];

describe('buildSequentialFunnel', () => {
  it('counts unique users per step, not events', () => {
    const events = [
      event('Note_Created', 'u1'),
      event('Note_Created', 'u1'),
      event('Note_Created', 'u1'),
      event('Note_Created', 'u2'),
    ];
    const funnel = buildSequentialFunnel(events, NOTES_STEPS);
    expect(funnel[0]).toEqual({ name: 'Created', count: 2, percentage: 100, dropoff: 0 });
  });

  it('excludes users who skipped a prior step', () => {
    const events = [
      event('Note_Created', 'u1'),
      event('Note_Saved', 'u1'),
      // u2 published without creating or saving in the window
      event('Note_Published', 'u2'),
    ];
    const funnel = buildSequentialFunnel(events, NOTES_STEPS);
    expect(funnel.map((s) => s.count)).toEqual([1, 1, 0, 0]);
  });

  it('produces monotonically non-increasing counts', () => {
    const events = [
      event('Note_Created', 'u1'),
      event('Note_Saved', 'u1'),
      event('Note_Published', 'u1'),
      event('Note_Shared', 'u1'),
      event('Note_Created', 'u2'),
      event('Note_Saved', 'u2'),
      // heavy out-of-funnel activity that previously inflated later steps
      event('Note_Saved', 'u3'),
      event('Note_Published', 'u3'),
      event('Note_Shared', 'u3'),
      event('Note_Shared', 'u4'),
    ];
    const funnel = buildSequentialFunnel(events, NOTES_STEPS);
    const counts = funnel.map((s) => s.count);
    expect(counts).toEqual([2, 2, 1, 1]);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('computes percentage vs first step and dropoff vs previous step', () => {
    const events = [
      event('Note_Created', 'u1'),
      event('Note_Created', 'u2'),
      event('Note_Created', 'u3'),
      event('Note_Created', 'u4'),
      event('Note_Saved', 'u1'),
      event('Note_Saved', 'u2'),
      event('Note_Published', 'u1'),
    ];
    const funnel = buildSequentialFunnel(events, NOTES_STEPS);
    expect(funnel[1].percentage).toBe(50); // 2 of 4
    expect(funnel[1].dropoff).toBe(50); // 4 → 2
    expect(funnel[2].percentage).toBe(25); // 1 of 4
    expect(funnel[2].dropoff).toBe(50); // 2 → 1
    expect(funnel[3].percentage).toBe(0);
    expect(funnel[3].dropoff).toBe(100); // 1 → 0
  });

  it('handles empty input without NaN', () => {
    const funnel = buildSequentialFunnel([], NOTES_STEPS);
    expect(funnel.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    for (const step of funnel) {
      expect(Number.isFinite(step.percentage)).toBe(true);
      expect(Number.isFinite(step.dropoff)).toBe(true);
    }
  });

  it('normalizes legacy event names before matching', () => {
    // Monitor_Created aliases to Automation_Created via EVENT_NAME_MAP
    const events = [event('Monitor_Created', 'u1')];
    const funnel = buildSequentialFunnel(events, [
      { name: 'Created', eventName: 'Automation_Created' },
    ]);
    expect(funnel[0].count).toBe(1);
  });

  it('models the collections funnel (Created → Viewed → Chat Started → Shared)', () => {
    const COLLECTION_STEPS = [
      { name: 'Created', eventName: 'Collection_Created' },
      { name: 'Viewed', eventName: 'Collection_Viewed' },
      { name: 'Chat Started', eventName: 'Collection_Chat_Started' },
      { name: 'Shared', eventName: 'Collection_Shared' },
    ];
    const events = [
      // u1 goes all the way through
      event('Collection_Created', 'u1'),
      event('Collection_Viewed', 'u1'),
      event('Collection_Chat_Started', 'u1'),
      event('Collection_Shared', 'u1'),
      // u2 chats but never shares
      event('Collection_Created', 'u2'),
      event('Collection_Viewed', 'u2'),
      event('Collection_Chat_Started', 'u2'),
      // u3 only views
      event('Collection_Created', 'u3'),
      event('Collection_Viewed', 'u3'),
      // u4 shares without ever creating/viewing/chatting in-window → excluded everywhere
      event('Collection_Shared', 'u4'),
    ];
    const funnel = buildSequentialFunnel(events, COLLECTION_STEPS);
    expect(funnel.map((s) => s.count)).toEqual([3, 3, 2, 1]);
    expect(funnel[3].name).toBe('Shared');
  });
});
