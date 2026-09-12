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

const DAY = '2026-09-10';

function event(
  name: string,
  uid: string,
  properties: Record<string, unknown> = {},
  date = DAY,
): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: Date.parse(`${date}T12:00:00Z`) / 1000,
      distinct_id: uid,
      $user_id: uid,
      platform: 'web',
      ...properties,
    },
  };
}

// a: the whole path through the tile. b: other Workstation tools (ignored).
// c: arrived via the sidebar row and hit the paywall. d: converted a
// collection, then reopened it.
const CURRENT: MixpanelEvent[] = [
  event('Workstation_View_Changed', 'a', { view: 'projects', via: 'tile' }),
  event('Workstation_Tool_Opened', 'a', { tool: 'projects', via: 'tile' }),
  event('Project_Start_Clicked', 'a', { via: 'projects_tab', gated: false }),
  event('Project_Created', 'a', { via: 'projects_tab', from_collection: false, sources_bucket: '0' }),
  event('Workstation_Tool_Opened', 'b', { tool: 'chats', via: 'tile' }),
  event('Workstation_View_Changed', 'b', { view: 'chats', via: 'tile' }),
  event('Workstation_View_Changed', 'c', { view: 'projects', via: 'row' }, '2026-09-09'),
  event('Project_Start_Clicked', 'c', { via: 'empty_state', gated: true }, '2026-09-09'),
  event('Project_Converted', 'd', { direction: 'to_project' }),
  event('Project_Opened', 'd', { has_plan: false, has_automation: false, sources_bucket: '1-3' }),
];

function status(events: MixpanelEvent[], overrides: Record<string, unknown> = {}) {
  return { events, dataUnavailable: false, servedStale: false, fetchedAt: '2026-09-11T08:00:00Z', ...overrides };
}

function url(query: string) {
  return new NextRequest(`http://localhost/api/metrics/projects?from=2026-09-04&to=2026-09-10&${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/metrics/projects', () => {
  it('narrows the generic Workstation events to Projects and counts each step once', async () => {
    mocks.fetchFiltered
      .mockResolvedValueOnce(status(CURRENT))
      .mockResolvedValueOnce(status([], { servedStale: true }));
    const { GET } = await import('./route');

    const body = await (await GET(url('platform=all&userType=all'))).json();

    // Current window, then the prior window of the same length, both narrow.
    expect(mocks.fetchFiltered).toHaveBeenCalledTimes(2);
    expect(mocks.fetchFiltered.mock.calls[0].slice(0, 2)).toEqual(['2026-09-04', '2026-09-10']);
    expect(mocks.fetchFiltered.mock.calls[1].slice(0, 2)).toEqual(['2026-08-28', '2026-09-03']);
    expect(mocks.fetchFiltered.mock.calls[0][2]).toEqual(
      expect.arrayContaining(['Workstation_View_Changed', 'Workstation_Tool_Opened', 'Project_Start_Clicked', 'Project_Created', 'Signup_Completed']),
    );

    expect(body).toMatchObject({
      projectsOpened: 2,
      uniqueOpeners: 2,
      tileOpens: 1,
      startClicks: 2,
      paywallHits: 1,
      projectsCreated: 1,
      uniqueCreators: 1,
      convertedToProject: 1,
      projectOpens: 1,
      uniqueProjectOpeners: 1,
    });
    expect(body.funnel.map((s: { name: string; count: number }) => [s.name, s.count])).toEqual([
      ['Opened Projects', 2],
      ['Start clicked', 2],
      ['Project created', 1],
    ]);
    expect(body.entryPaths).toEqual(expect.arrayContaining([{ via: 'tile', count: 1 }, { via: 'row', count: 1 }]));
    expect(body.createdByVia).toEqual([{ via: 'projects_tab', count: 1 }]);
    expect(body.startClicksByGate).toEqual([{ gate: 'Pro', count: 1 }, { gate: 'Paywalled', count: 1 }]);

    expect(body.dailyData).toHaveLength(7);
    expect(body.dailyData.find((d: { date: string }) => d.date === '2026-09-10')).toEqual({
      date: '2026-09-10', opened: 1, tileOpens: 1, startClicks: 1, created: 1,
    });
    expect(body.dailyData.find((d: { date: string }) => d.date === '2026-09-09')).toEqual({
      date: '2026-09-09', opened: 1, tileOpens: 0, startClicks: 1, created: 0,
    });

    // An empty prior window reads as "New", never as +100%.
    expect(body.projectsCreatedTrend).toBeNull();
    expect(body.startClicksTrend).toBeNull();
    expect(body.priorRange).toEqual({ from: '2026-08-28', to: '2026-09-03' });
    expect(body.servedStale).toBe(true);
    expect(body.dataAsOf).toBe('2026-09-11T08:00:00Z');
    expect(body.lastUpdated).toBe('fallback-updated-at');
  });

  it('is empty under a non-web platform filter (Projects is web only)', async () => {
    mocks.fetchFiltered.mockResolvedValue(status(CURRENT));
    const { GET } = await import('./route');

    const body = await (await GET(url('platform=iOS&userType=all'))).json();

    expect(body).toMatchObject({ projectsOpened: 0, tileOpens: 0, startClicks: 0, projectsCreated: 0 });
    expect(body.funnel.map((s: { count: number }) => s.count)).toEqual([0, 0, 0]);
    expect(body.entryPaths).toEqual([]);
  });

  it('reports trends as unknown when the prior fetch failed', async () => {
    mocks.fetchFiltered
      .mockResolvedValueOnce(status(CURRENT))
      .mockResolvedValueOnce(status([], { dataUnavailable: true }));
    const { GET } = await import('./route');

    const body = await (await GET(url('platform=all&userType=all'))).json();

    expect(body.projectsOpened).toBe(2);
    expect(body.dataUnavailable).toBe(false);
    expect(body.projectsOpenedTrend).toBeNull();
    expect(body.tileOpensTrend).toBeNull();
  });
});
