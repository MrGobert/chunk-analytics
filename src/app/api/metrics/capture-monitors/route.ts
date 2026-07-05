// Capture & Monitors — Save-to-Chunk capture volume (by source/content type)
// and Research Monitor creation (what users watch, cadence/depth mix).
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  getLastUpdated,
} from '@/lib/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { buildFunnel } from '@/lib/funnel';
import { MixpanelEvent } from '@/types/mixpanel';

// inbox_capture_created is emitted server-side by cerebral for EVERY capture
// source; the Monitor_* + inbox triage events are client-side (web + Apple).
const CAPTURE_MONITOR_EVENTS = [
  'Monitor_Created',
  'inbox_capture_created',
  'inbox_item_accepted',
  'inbox_item_discarded',
  'inbox_item_to_collection',
];

function platformOf(e: MixpanelEvent): string {
  const os = (e.properties.$os as string) || '';
  const mpLib = (e.properties.mp_lib as string) || '';
  const platform = (e.properties.platform as string) || '';
  if (mpLib === 'web' || platform === 'web') return 'Web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iPadOS') return 'iPadOS';
  if (os === 'iOS' || platform === 'iOS') return 'iOS';
  if (os === 'visionOS' || platform === 'visionOS') return 'visionOS';
  // Captures land server-side with platform "server" — surface the origin app
  // via the event's own source when the transport platform is opaque.
  return 'Other';
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const raw = await fetchMixpanelEventsFiltered(
      dateRange.from,
      dateRange.to,
      CAPTURE_MONITOR_EVENTS,
    );
    const events = filterByPlatform(raw, platform);

    const cadence = new Map<string, number>();
    const reportType = new Map<string, number>();
    const topics = new Map<string, number>();
    const monitorPlatform = new Map<string, number>();
    const source = new Map<string, number>();
    const contentType = new Map<string, number>();
    const daily = new Map<string, { monitors: number; captures: number }>();

    let monitorsCreated = 0;
    let capturesTotal = 0;
    let accepted = 0;
    let discarded = 0;
    let toCollection = 0;

    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    const dayOf = (t: number) => formatDate(new Date(t * 1000));
    const ensureDay = (d: string) => {
      if (!daily.has(d)) daily.set(d, { monitors: 0, captures: 0 });
      return daily.get(d)!;
    };

    for (const e of events) {
      const t = e.properties.time as number;
      const p = e.properties as Record<string, unknown>;
      switch (e.event) {
        case 'Monitor_Created': {
          monitorsCreated++;
          bump(cadence, String(p.cadence ?? 'unknown'));
          bump(reportType, String(p.report_type ?? 'unknown'));
          const topic = String(p.query_truncated ?? '').trim();
          if (topic) bump(topics, topic);
          bump(monitorPlatform, platformOf(e));
          ensureDay(dayOf(t)).monitors++;
          break;
        }
        case 'inbox_capture_created': {
          capturesTotal++;
          bump(source, String(p.source ?? 'unknown'));
          bump(contentType, String(p.content_type ?? 'unknown'));
          ensureDay(dayOf(t)).captures++;
          break;
        }
        case 'inbox_item_accepted':
          accepted++;
          break;
        case 'inbox_item_discarded':
          discarded++;
          break;
        case 'inbox_item_to_collection':
          toCollection++;
          break;
      }
    }

    const toArr = (m: Map<string, number>) =>
      Array.from(m)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    const topTopics = Array.from(topics)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const dailyTrend = Array.from(daily)
      .map(([date, o]) => ({ date, monitors: o.monitors, captures: o.captures }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalTriaged = accepted + discarded + toCollection;
    const kept = accepted + toCollection;
    const keepRate = totalTriaged > 0 ? kept / totalTriaged : 0;
    const activeSources = source.size;

    const triageFunnel = buildFunnel([
      { name: 'Captured', count: capturesTotal },
      { name: 'Triaged', count: totalTriaged },
      { name: 'Kept', count: kept },
    ]);

    const triageOutcomes = [
      { name: 'Accepted', value: accepted },
      { name: 'To Collection', value: toCollection },
      { name: 'Discarded', value: discarded },
    ].filter((o) => o.value > 0);

    return NextResponse.json(
      {
        monitorsCreated,
        capturesTotal,
        keepRate,
        activeSources,
        cadenceMix: toArr(cadence),
        reportTypeMix: toArr(reportType),
        topTopics,
        monitorsByPlatform: toArr(monitorPlatform),
        capturesBySource: toArr(source),
        capturesByContentType: toArr(contentType),
        triageFunnel,
        triageOutcomes,
        dailyTrend,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching capture/monitors metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch capture/monitors metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
