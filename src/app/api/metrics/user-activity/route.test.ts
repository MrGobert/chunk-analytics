import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MixpanelEvent } from '@/types/mixpanel';

const mocks = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
}));

vi.mock('@/lib/mixpanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mixpanel')>();
  return {
    ...actual,
    fetchMixpanelEventsWithStatus: mocks.fetchEvents,
    getLastUpdated: () => 'fallback-updated-at',
  };
});

function event(date: string): MixpanelEvent {
  return {
    event: 'Search_Performed',
    properties: {
      time: Date.parse(date) / 1000,
      distinct_id: 'device-id',
      $user_id: 'customer-1',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/metrics/user-activity', () => {
  it('keeps the complete calendar month and exposes stale snapshot metadata', async () => {
    mocks.fetchEvents.mockResolvedValue({
      events: [
        event('2026-07-01T12:00:00Z'),
        event('2026-07-02T12:00:00Z'),
      ],
      dataUnavailable: false,
      servedStale: true,
      fetchedAt: '2026-07-31T08:00:00Z',
    });
    const { GET } = await import('./route');

    const response = await GET(new NextRequest(
      'http://localhost/api/metrics/user-activity'
      + '?uid=customer-1&from=2026-07-02&to=2026-07-31',
    ));
    const body = await response.json();

    expect(mocks.fetchEvents).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
    expect(body.totalEvents).toBe(1);
    expect(body.usageStats.searches).toBe(1);
    expect(body.monthToDateUsageStats.searches).toBe(2);
    expect(body.servedStale).toBe(true);
    expect(body.dataAsOf).toBe('2026-07-31T08:00:00Z');
    expect(body.lastUpdated).toBe('2026-07-31T08:00:00Z');
  });
});
