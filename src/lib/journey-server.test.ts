import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixpanelEvent } from '@/types/mixpanel';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/mixpanel', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mixpanel')>(),
  fetchMixpanelEventsFilteredWithStatus: mocks.fetch,
}));

const start = Date.parse('2026-07-01T12:00:00Z') / 1000;
const signup: MixpanelEvent = { event: 'Signup_Completed', properties: { distinct_id: 'account', platform: 'iOS', time: start } };
beforeEach(() => vi.clearAllMocks());

describe('journey export snapshot', () => {
  it('fetches the complete follow-up range and caps maturity at the cached export timestamp', async () => {
    mocks.fetch.mockResolvedValue({ events: [signup], dataUnavailable: false, servedStale: true, fetchedAt: '2026-07-02T00:00:00Z' });
    const { getJourneySnapshot } = await import('./journey-server');
    const { metrics } = await getJourneySnapshot({ dateRange: { from: '2026-07-01', to: '2026-07-01' }, platform: 'iOS' });
    expect(mocks.fetch.mock.calls[0].slice(0, 2)).toEqual(['2026-07-01', '2026-07-31']);
    expect(metrics.signups).toBe(1);
    expect(metrics.eligible24h).toBe(0);
    expect(metrics.observedThrough).toBe('2026-07-02T00:00:00.000Z');
    expect(metrics.servedStale).toBe(true);
  });

  it('exposes unavailable data instead of pretending a missing export is observed zero', async () => {
    mocks.fetch.mockResolvedValue({ events: [], dataUnavailable: true, servedStale: false, fetchedAt: null });
    const { getJourneySnapshot } = await import('./journey-server');
    const { metrics } = await getJourneySnapshot({ dateRange: { from: '2026-07-01', to: '2026-07-01' }, platform: 'all' });
    expect(metrics.dataUnavailable).toBe(true);
    expect(metrics.successfulValueRate).toBeNull();
    expect(metrics.paidConversion30d).toBeNull();
  });

  it('classifies the complete account before user-type filtering', async () => {
    mocks.fetch.mockResolvedValue({ events: [signup, { event: 'Purchase_Completed', properties: {
      time: start + 60, distinct_id: 'other-device', account_id: 'account', platform: 'macOS',
    } }, { event: '$identify', properties: { time: start, distinct_id: 'anonymous', $identified_id: 'account', $anon_id: 'anonymous' } }],
    dataUnavailable: false, servedStale: false, fetchedAt: '2026-08-02T00:00:00Z' });
    const { getJourneySnapshot } = await import('./journey-server');
    const options = { dateRange: { from: '2026-07-01', to: '2026-07-01' }, platform: 'iOS' };
    expect((await getJourneySnapshot({ ...options, userType: 'subscribers' })).metrics.signups).toBe(1);
    expect((await getJourneySnapshot({ ...options, userType: 'visitors' })).metrics.signups).toBe(0);
  });
});
