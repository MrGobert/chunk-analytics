import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MixpanelEvent } from '@/types/mixpanel';

const mocks = vi.hoisted(() => ({
  fetchFiltered: vi.fn(),
}));

vi.mock('@/lib/mixpanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mixpanel')>();
  return {
    ...actual,
    fetchMixpanelEventsFilteredWithStatus: mocks.fetchFiltered,
    getLastUpdated: () => 'fallback-updated-at',
  };
});

function event(name: string, uid: string, properties: Record<string, unknown> = {}): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: Date.parse('2026-09-26T12:00:00Z') / 1000,
      distinct_id: uid,
      $user_id: uid,
      platform: 'web',
      ...properties,
    },
  };
}

const EVENTS: MixpanelEvent[] = [
  event('Chat_Starter_Shown', 'a', { kind: 'continue', personalized: true, launch: 'send', intent: 'resume', slot_index: 0 }),
  event('Chat_Starter_Tapped', 'a', { kind: 'continue', personalized: true, launch: 'send', intent: 'resume', slot_index: 0 }),
  event('Chat_Starter_Shown', 'b', { kind: 'continue', personalized: true, launch: 'send', platform: 'iOS', $os: 'iOS' }),
  event('Chat_Starter_Fetched', 'a', { status: 'ready', trigger: 'mount', first_paint: 'generic_timeout' }),
];

function status(events: MixpanelEvent[], overrides: Record<string, unknown> = {}) {
  return { events, dataUnavailable: false, servedStale: false, fetchedAt: '2026-09-27T08:00:00Z', ...overrides };
}

function url(query: string) {
  return new NextRequest(`http://localhost/api/metrics/chat-starters?from=2026-09-21&to=2026-09-27&${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/metrics/chat-starters', () => {
  it('fetches the starter events plus user-type context for the window and applies the platform filter', async () => {
    mocks.fetchFiltered.mockResolvedValueOnce(status(EVENTS));
    const { GET } = await import('./route');

    const response = await GET(url('platform=web&userType=all'));
    const body = await response.json();

    expect(mocks.fetchFiltered).toHaveBeenCalledTimes(1);
    const [from, to, names] = mocks.fetchFiltered.mock.calls[0];
    expect([from, to]).toEqual(['2026-09-21', '2026-09-27']);
    expect(names).toEqual(
      expect.arrayContaining([
        'Chat_Starter_Shown',
        'Chat_Starter_Tapped',
        'Chat_Starter_Draft_Sent',
        'Chat_Starter_Followup',
        'Chat_Starter_Not_Interested',
        'Chat_Starter_Fetched',
        'Chat_Starter_Why_Opened',
        'Chat_Starter_More_Tapped',
        'Chat_Starter_Validation_Failed',
        // Context for the user-type filter, legacy aliases included.
        'Signup_Completed',
        'SignUp',
        'Purchase_Completed',
        '$ae_iap',
      ]),
    );

    // The iOS card is outside the web filter.
    expect(body).toMatchObject({
      cardsShown: 1,
      tapped: 1,
      tapThrough: 1,
      skeletonTimeoutRate: 1,
      platform: 'web',
      userType: 'all',
      dateRange: { from: '2026-09-21', to: '2026-09-27' },
      dataUnavailable: false,
      servedStale: false,
      dataAsOf: '2026-09-27T08:00:00Z',
      lastUpdated: 'fallback-updated-at',
    });
    expect(body.byIntent.map((r: { key: string }) => r.key)).toEqual(['resume']);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('passes a failed export through as dataUnavailable with an empty payload', async () => {
    mocks.fetchFiltered.mockResolvedValueOnce(status([], { dataUnavailable: true, fetchedAt: null }));
    const { GET } = await import('./route');

    const body = await (await GET(url('platform=all&userType=all'))).json();

    expect(body).toMatchObject({ dataUnavailable: true, dataAsOf: null, cardsShown: 0, tapThrough: 0, fetches: 0 });
    expect(body.byIntent).toEqual([]);
    expect(body.funnel.map((s: { count: number }) => s.count)).toEqual([0, 0, 0, 0]);
  });

  it('answers 500 when the export throws', async () => {
    mocks.fetchFiltered.mockRejectedValueOnce(new Error('export exploded'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('./route');

    const response = await GET(url('platform=all&userType=all'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Failed to fetch chat starters metrics' });
    quiet.mockRestore();
  });
});
