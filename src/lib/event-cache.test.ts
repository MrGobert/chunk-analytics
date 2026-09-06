import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixpanelEvent } from '@/types/mixpanel';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, default: { ...actual, tmpdir: () => state.directory } };
});

let cache: typeof import('./event-cache');
const row: MixpanelEvent = {
  event: 'Search_Performed',
  properties: { distinct_id: 'customer', time: 1788220800, $insert_id: 'one-send' },
};

beforeEach(async () => {
  const os = await vi.importActual<typeof import('os')>('os');
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-cache-test-'));
  vi.resetModules();
  cache = await import('./event-cache');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(state.directory, { recursive: true, force: true });
});

function legacyFile(variant: string, ageMs: number): { filename: string; timestamp: number } {
  const suffix = variant ? `_${variant}` : '';
  const filename = path.join(state.directory, `chunk_analytics_cache_2026-09-01_2026-09-05${suffix}.json`);
  fs.writeFileSync(filename, JSON.stringify([row, row, row, row, row]));
  const date = new Date(Date.now() - ageMs);
  fs.utimesSync(filename, date, date);
  return { filename, timestamp: fs.statSync(filename).mtimeMs };
}

describe.each(['', 'filtered-events'])('event cache variant "%s"', (variant) => {
  async function fetchEvents() {
    const mixpanel = await import('./mixpanel');
    return variant
      ? mixpanel.fetchMixpanelEventsFilteredWithStatus('2026-09-01', '2026-09-05', ['Search_Performed'])
      : mixpanel.fetchMixpanelEventsWithStatus('2026-09-01', '2026-09-05');
  }

  it('returns deduplicated events on the very first API response as well as cache hits', async () => {
    vi.stubEnv('MIXPANEL_API_SECRET', 'test-only');
    const owner = { ...row, properties: { ...row.properties, distinct_id: 'I3JdK0ufgyN9So4rSOf4yxK1Drl1' } };
    const fetch = vi.fn().mockResolvedValue(new Response([row, row, row, row, row, owner].map((e) => JSON.stringify(e)).join('\n')));
    vi.stubGlobal('fetch', fetch);
    expect((await fetchEvents()).events).toEqual([row]);
    expect((await fetchEvents()).events).toEqual([row]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('repairs a pre-fix disk export and preserves its timestamp on memory hits', async () => {
    const { timestamp } = legacyFile(variant, 30_000);
    const first = await cache.getCachedEventsAsync('2026-09-01', '2026-09-05', variant);
    const second = await cache.getCachedEventsAsync('2026-09-01', '2026-09-05', variant);
    expect(first).toEqual({ events: [row], timestamp });
    expect(second).toEqual(first);
  });

  it('repairs stale fallback data without pretending the snapshot is fresh', async () => {
    const { timestamp } = legacyFile(variant, 60 * 60 * 1000);
    expect(await cache.getCachedEventsAsync('2026-09-01', '2026-09-05', variant)).toBeNull();
    expect(await cache.getStaleCachedEvents('2026-09-01', '2026-09-05', variant))
      .toEqual({ events: [row], timestamp });
  });

  it('stores one copy in both memory and disk for fresh exports', async () => {
    await cache.setCachedEventsAsync('2026-09-01', '2026-09-05', [row, row], variant);
    expect((await cache.getCachedEventsAsync('2026-09-01', '2026-09-05', variant))?.events)
      .toEqual([row]);
    const filename = fs.readdirSync(state.directory).find((name) => name.endsWith('.json'))!;
    expect(JSON.parse(fs.readFileSync(path.join(state.directory, filename), 'utf8'))).toEqual([row]);
  });
});
