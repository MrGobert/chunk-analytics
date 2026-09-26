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
    fetchMixpanelEventsFiltered: mocks.fetchFiltered,
    getLastUpdated: () => 'fallback-updated-at',
  };
});

function created(properties: Record<string, unknown>, name = 'Automation_Created'): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: Date.parse('2026-09-10T12:00:00Z') / 1000,
      distinct_id: 'u1',
      platform: 'web',
      ...properties,
    },
  };
}

function url() {
  return new NextRequest('http://localhost/api/metrics/capture-monitors?from=2026-09-04&to=2026-09-10&platform=all');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/metrics/capture-monitors', () => {
  it('counts what each automation was set up to do from its enums, never its typed topic', async () => {
    mocks.fetchFiltered.mockResolvedValueOnce([
      created({ kind: 'watcher', condition_type: 'price_change', query_truncated: 'my private topic' }),
      created({ kind: 'watcher', condition_type: 'price_change' }),
      created({ kind: 'digest', template: 'weekly_briefing' }),
      created({ kind: 'agent_task', recipe_id: 'competitor_scan' }),
      // Native sends an empty recipe for a task built without one.
      created({ kind: 'agent_task', recipe_id: '' }),
      // Research is the report-type mix's; an old client may send no kind.
      created({ kind: 'research', report_type: 'standard' }),
      created({ condition_type: 'price_change' }, 'Monitor_Created'),
    ]);
    const { GET } = await import('./route');

    const response = await GET(url());
    const body = await response.json();

    expect(body.monitorsCreated).toBe(7);
    expect(body.topSetups).toEqual([
      { kind: 'watcher', setup: 'price_change', count: 2 },
      { kind: 'digest', setup: 'weekly_briefing', count: 1 },
      { kind: 'agent_task', setup: 'competitor_scan', count: 1 },
    ]);
    expect(body).not.toHaveProperty('topTopics');
    expect(JSON.stringify(body)).not.toContain('my private topic');
  });
});
