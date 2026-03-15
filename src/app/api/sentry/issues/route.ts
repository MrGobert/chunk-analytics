import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const SENTRY_API_URL = 'https://sentry.io/api/0';
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || '';
const SENTRY_ORG = process.env.SENTRY_ORG || 'curious-minds-software';

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  isUnhandled: boolean;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: {
    id: string;
    name: string;
    slug: string;
    platform: string;
  };
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  statusDetails: Record<string, unknown>;
  type: string;
  platform: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project'); // optional: filter by project slug
  const query = searchParams.get('query') || 'is:unresolved';
  const sort = searchParams.get('sort') || 'freq';
  const limit = searchParams.get('limit') || '25';
  const statsPeriod = searchParams.get('statsPeriod') || '24h';

  if (!SENTRY_AUTH_TOKEN) {
    return NextResponse.json({ error: 'SENTRY_AUTH_TOKEN not configured' }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({
      query,
      sort,
      limit,
      statsPeriod,
    });

    if (project) {
      params.set('project', project);
    }

    const response = await fetch(
      `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/issues/?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sentry API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Sentry API error: ${response.status}` },
        { status: response.status }
      );
    }

    const issues: SentryIssue[] = await response.json();

    return NextResponse.json({
      issues: issues.map((issue) => ({
        id: issue.id,
        shortId: issue.shortId,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        status: issue.status,
        isUnhandled: issue.isUnhandled,
        count: parseInt(issue.count, 10),
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        project: issue.project.slug,
        projectName: issue.project.name,
        platform: issue.platform || issue.project.platform,
        type: issue.metadata?.type || issue.type,
        value: issue.metadata?.value || '',
        filename: issue.metadata?.filename || '',
        function: issue.metadata?.function || '',
      })),
      total: issues.length,
    });
  } catch (error) {
    console.error('Sentry fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch Sentry issues' }, { status: 500 });
  }
}
