import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function loadRoute(token = 'test-token') {
  vi.resetModules();
  vi.stubEnv('ANALYTICS_API_URL', 'https://analytics.example.test');
  vi.stubEnv('CEREBRAL_AUTH_TOKEN', token);
  return import('./route');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/rc/customer-search', () => {
  it('requires a UID or email query', async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      new NextRequest('http://localhost/api/rc/customer-search?q=%20%20'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Customer UID or email address is required',
    });
  });

  it('forwards an encoded query and returns the canonical customer identity', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json({
        uid: ' canonical-uid ',
        email: 'person+test@example.com',
        name: 'Test Person',
        ignored: 'not exposed',
      }),
    );
    vi.stubGlobal('fetch', upstreamFetch);
    const { GET } = await loadRoute();

    const response = await GET(
      new NextRequest(
        'http://localhost/api/rc/customer-search?q=person%2Btest%40example.com',
      ),
    );

    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://analytics.example.test/api/analytics/customer-search?q=person%2Btest%40example.com',
      expect.objectContaining({
        cache: 'no-store',
        headers: {
          Authorization: 'test-token',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      uid: 'canonical-uid',
      email: 'person+test@example.com',
      name: 'Test Person',
    });
  });

  it('preserves a not-found response from the analytics API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ error: 'No matching customer' }, { status: 404 }),
      ),
    );
    const { GET } = await loadRoute();

    const response = await GET(
      new NextRequest('http://localhost/api/rc/customer-search?q=missing'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'No matching customer',
    });
  });

  it('rejects a successful upstream response without a canonical UID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ email: 'person@example.com' })),
    );
    const { GET } = await loadRoute();

    const response = await GET(
      new NextRequest(
        'http://localhost/api/rc/customer-search?q=person%40example.com',
      ),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Customer lookup returned an invalid response',
    });
  });
});
