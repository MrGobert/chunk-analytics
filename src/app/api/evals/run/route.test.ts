import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function loadRoute(token = 'test-token') {
  vi.resetModules();
  vi.stubEnv('ANALYTICS_API_URL', 'https://analytics.example.test');
  vi.stubEnv('CEREBRAL_AUTH_TOKEN', token);
  return import('./route');
}

function postRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/evals/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/evals/run', () => {
  it('forwards the research coverage selection to the analytics backend', async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ run_id: 'run-1', status: 'queued' }));
    vi.stubGlobal('fetch', upstreamFetch);
    const { POST } = await loadRoute();

    const response = await POST(
      postRequest({ research_types: ['outline_report', 'deep'] })
    );

    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://analytics.example.test/api/analytics/evals/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ research_types: ['outline_report', 'deep'] }),
      })
    );
    expect(response.status).toBe(200);
  });

  it('forwards an explicitly empty selection instead of falling back to defaults', async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ run_id: 'run-2', status: 'queued' }));
    vi.stubGlobal('fetch', upstreamFetch);
    const { POST } = await loadRoute();

    await POST(postRequest({ research_types: [] }));

    expect(upstreamFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ research_types: [] }) })
    );
  });

  it('sends an empty body when the request carries no usable selection', async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ run_id: 'run-3', status: 'queued' }));
    vi.stubGlobal('fetch', upstreamFetch);
    const { POST } = await loadRoute();

    // No body at all, and a malformed selection: both must degrade to the
    // backend's own defaults rather than 4xx-ing the dashboard.
    await POST(postRequest());
    await POST(postRequest({ research_types: 'deep' }));

    for (const call of upstreamFetch.mock.calls) {
      expect(call[1].body).toBe('{}');
    }
  });

  it('passes a 409 (run already in progress) through with its run_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ error: 'A run is already in progress', run_id: 'live' }, { status: 409 })
      )
    );
    const { POST } = await loadRoute();

    const response = await POST(postRequest({ research_types: ['deep'] }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A run is already in progress',
      run_id: 'live',
    });
  });

  it('refuses to call the backend without an auth token', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);
    const { POST } = await loadRoute('');

    const response = await POST(postRequest({ research_types: ['deep'] }));

    expect(response.status).toBe(500);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
