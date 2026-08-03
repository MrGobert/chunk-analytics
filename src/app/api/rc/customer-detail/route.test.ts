import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function loadRoute() {
  vi.resetModules();
  vi.stubEnv('ANALYTICS_API_URL', 'https://analytics.example.test');
  vi.stubEnv('CEREBRAL_AUTH_TOKEN', 'test-token');
  return import('./route');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/rc/customer-detail', () => {
  it('requires a customer UID', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);
    const { GET } = await loadRoute();

    const response = await GET(
      new NextRequest('http://localhost/api/rc/customer-detail'),
    );

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('forwards reserved UID characters through an encoded query parameter', async () => {
    const uid = 'acct/tenant?region#1';
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json({ uid, email: 'person@example.org' }),
    );
    vi.stubGlobal('fetch', upstreamFetch);
    const { GET } = await loadRoute();
    const requestUrl = new URL('http://localhost/api/rc/customer-detail');
    requestUrl.searchParams.set('uid', uid);

    const response = await GET(new NextRequest(requestUrl));
    const [upstreamUrl, options] = upstreamFetch.mock.calls[0];

    expect(upstreamUrl).toBeInstanceOf(URL);
    expect(upstreamUrl.pathname).toBe('/api/analytics/customer-detail');
    expect(upstreamUrl.searchParams.get('uid')).toBe(uid);
    expect(options).toEqual(expect.objectContaining({
      cache: 'no-store',
      headers: {
        Authorization: 'test-token',
        'Content-Type': 'application/json',
      },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      uid,
      email: 'person@example.org',
    }));
  });
});
