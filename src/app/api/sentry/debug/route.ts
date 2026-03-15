import { NextResponse } from 'next/server';

export const maxDuration = 15;

const SENTRY_API_URL = 'https://sentry.io/api/0';
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || '';
const SENTRY_ORG = process.env.SENTRY_ORG || 'curious-minds-software';

/**
 * Debug endpoint to verify Sentry API token permissions.
 * Tests each API endpoint the dashboard needs and reports which ones work.
 * Hit /api/sentry/debug to diagnose token issues.
 */
export async function GET() {
  if (!SENTRY_AUTH_TOKEN) {
    return NextResponse.json({
      status: 'error',
      message: 'SENTRY_AUTH_TOKEN not set',
      tokenPrefix: null,
    });
  }

  const headers = {
    Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const tests = [
    {
      name: 'Organization access',
      scope: 'org:read',
      url: `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/`,
    },
    {
      name: 'Project list',
      scope: 'project:read',
      url: `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/projects/`,
    },
    {
      name: 'Issues list',
      scope: 'event:read',
      url: `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/issues/?limit=1&statsPeriod=24h`,
    },
    {
      name: 'Org stats (stats_v2)',
      scope: 'org:read',
      url: `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/stats_v2/?field=sum(quantity)&category=error&statsPeriod=1h&interval=1h`,
    },
    {
      name: 'Project stats (javascript-nextjs)',
      scope: 'project:read',
      url: `${SENTRY_API_URL}/projects/${SENTRY_ORG}/javascript-nextjs/stats/?stat=received&resolution=1d&statsPeriod=24h`,
    },
    {
      name: 'Project stats (cerebral-python-flask)',
      scope: 'project:read',
      url: `${SENTRY_API_URL}/projects/${SENTRY_ORG}/cerebral-python-flask/stats/?stat=received&resolution=1d&statsPeriod=24h`,
    },
    {
      name: 'Project stats (apple-ios)',
      scope: 'project:read',
      url: `${SENTRY_API_URL}/projects/${SENTRY_ORG}/apple-ios/stats/?stat=received&resolution=1d&statsPeriod=24h`,
    },
  ];

  const results = await Promise.all(
    tests.map(async (test) => {
      try {
        const res = await fetch(test.url, { headers, cache: 'no-store' });
        return {
          name: test.name,
          scopeNeeded: test.scope,
          status: res.status,
          ok: res.ok,
          preview: res.ok
            ? JSON.stringify(await res.json()).substring(0, 200)
            : await res.text().then((t) => t.substring(0, 200)),
        };
      } catch (error) {
        return {
          name: test.name,
          scopeNeeded: test.scope,
          status: 0,
          ok: false,
          preview: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    status: allOk ? 'all_working' : 'issues_found',
    tokenPrefix: SENTRY_AUTH_TOKEN.substring(0, 15) + '...',
    org: SENTRY_ORG,
    tests: results,
    recommendation: allOk
      ? 'All Sentry API endpoints are accessible.'
      : 'Some endpoints returned errors. Create a new token at https://sentry.io/settings/account/api/auth-tokens/ with scopes: org:read, project:read, event:read',
  });
}
