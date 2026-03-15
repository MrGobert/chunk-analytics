import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const SENTRY_API_URL = 'https://sentry.io/api/0';
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || '';
const SENTRY_ORG = process.env.SENTRY_ORG || 'curious-minds-software';

// Project slugs to monitor
const PROJECTS = [
  { slug: 'javascript-nextjs', label: 'Chunk Web', platform: 'web' },
  { slug: 'cerebral-python-flask', label: 'Cerebral API', platform: 'backend' },
];

interface StatsPoint {
  ts: number;
  value: number;
}

interface ProjectStats {
  slug: string;
  label: string;
  platform: string;
  received: StatsPoint[];
  filtered: StatsPoint[];
  totalEvents: number;
  totalFiltered: number;
}

async function fetchProjectStats(
  projectSlug: string,
  stat: string,
  resolution: string,
  statsPeriod: string
): Promise<StatsPoint[]> {
  const params = new URLSearchParams({
    stat,
    resolution,
    ...(statsPeriod && { statsPeriod }),
  });

  const response = await fetch(
    `${SENTRY_API_URL}/projects/${SENTRY_ORG}/${projectSlug}/stats/?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    console.error(`Sentry stats error for ${projectSlug}:`, response.status);
    return [];
  }

  const data: [number, number][] = await response.json();
  return data.map(([ts, value]) => ({ ts, value }));
}

async function fetchOrgStats(
  field: string,
  category: string,
  statsPeriod: string,
  interval: string,
  groupBy?: string
): Promise<{ groups: { by: Record<string, string>; totals: Record<string, number>; series: Record<string, number[]> }[]; intervals: string[] }> {
  const params = new URLSearchParams({
    field,
    category,
    statsPeriod,
    interval,
  });

  if (groupBy) {
    params.set('groupBy', groupBy);
  }

  const response = await fetch(
    `${SENTRY_API_URL}/organizations/${SENTRY_ORG}/stats_v2/?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    console.error('Sentry org stats error:', response.status);
    return { groups: [], intervals: [] };
  }

  return response.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const statsPeriod = searchParams.get('statsPeriod') || '24h';
  const resolution = searchParams.get('resolution') || '1h';

  if (!SENTRY_AUTH_TOKEN) {
    return NextResponse.json({ error: 'SENTRY_AUTH_TOKEN not configured' }, { status: 500 });
  }

  try {
    // Fetch stats for all projects in parallel
    const projectStatsPromises = PROJECTS.map(async (project) => {
      const [received, filtered] = await Promise.all([
        fetchProjectStats(project.slug, 'received', resolution, statsPeriod),
        fetchProjectStats(project.slug, 'rejected', resolution, statsPeriod),
      ]);

      const totalEvents = received.reduce((sum, p) => sum + p.value, 0);
      const totalFiltered = filtered.reduce((sum, p) => sum + p.value, 0);

      return {
        ...project,
        received,
        filtered,
        totalEvents,
        totalFiltered,
      } as ProjectStats;
    });

    // Fetch org-wide error stats grouped by project
    const orgStatsPromise = fetchOrgStats(
      'sum(quantity)',
      'error',
      statsPeriod,
      resolution,
      'project'
    );

    const [projectStats, orgStats] = await Promise.all([
      Promise.all(projectStatsPromises),
      orgStatsPromise,
    ]);

    // Aggregate totals
    const totalErrors = projectStats.reduce((sum, p) => sum + p.totalEvents, 0);

    // Build time series for combined error trend
    const combinedTimeSeries: { date: string; errors: number }[] = [];
    if (projectStats.length > 0 && projectStats[0].received.length > 0) {
      for (let i = 0; i < projectStats[0].received.length; i++) {
        const ts = projectStats[0].received[i].ts;
        const totalAtPoint = projectStats.reduce(
          (sum, p) => sum + (p.received[i]?.value || 0),
          0
        );
        combinedTimeSeries.push({
          date: new Date(ts * 1000).toISOString(),
          errors: totalAtPoint,
        });
      }
    }

    return NextResponse.json({
      projects: projectStats.map((p) => ({
        slug: p.slug,
        label: p.label,
        platform: p.platform,
        totalEvents: p.totalEvents,
        totalFiltered: p.totalFiltered,
      })),
      totalErrors,
      errorTrend: combinedTimeSeries,
      orgStats: orgStats.groups,
      intervals: orgStats.intervals,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sentry stats fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch Sentry stats' }, { status: 500 });
  }
}
