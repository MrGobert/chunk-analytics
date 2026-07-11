// Product reliability — user-facing failures the client emits to Mixpanel.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  getLastUpdated,
  normalizeEventName,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';

const RELIABILITY_EVENTS = [
  'Search_Performed', 'Search Performed', 'Search', 'Search_Failed',
  'Artifact_Created', 'Artifact_Failed',
  'Image_Generation_Started', 'Image_Generation_Completed', 'Image_Generation_Failed',
  'Purchase_Failed',
  'Error_Encountered',
  'Connector_Status_Degraded',
  // Automation runs have no server-side failure event yet; Automation_Run_Viewed
  // carries run_status, so failure rate is measured over VIEWED runs only
  // (biased proxy — replace once cerebral emits a run-completion event).
  // Legacy Monitor_Run_Viewed kept for un-updated Apple clients; normalized below.
  'Automation_Run_Viewed',
  'Monitor_Run_Viewed',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const raw = await fetchMixpanelEventsFiltered(dateRange.from, dateRange.to, RELIABILITY_EVENTS);
    const events = filterByPlatform(raw, platform);

    const count = (name: string) => events.filter((e) => normalizeEventName(e.event) === name || e.event === name).length;

    const searchOk = events.filter((e) => ['Search_Performed', 'Search Performed', 'Search'].includes(e.event)).length;
    const searchFailed = count('Search_Failed');
    const artifactCreated = count('Artifact_Created');
    const artifactFailed = count('Artifact_Failed');
    const imgCompleted = count('Image_Generation_Completed');
    const imgFailed = count('Image_Generation_Failed');
    const purchaseFailed = count('Purchase_Failed');

    const monitorRunsViewed = events.filter((e) => normalizeEventName(e.event) === 'Automation_Run_Viewed');
    const monitorRunsFailed = monitorRunsViewed.filter((e) =>
      ['failed', 'error'].includes(String(e.properties.run_status ?? ''))
    ).length;

    const rate = (fail: number, total: number) => (total > 0 ? fail / total : 0);

    const kpis = {
      searchFailRate: rate(searchFailed, searchOk + searchFailed),
      artifactFailRate: rate(artifactFailed, artifactCreated + artifactFailed),
      imageFailRate: rate(imgFailed, imgCompleted + imgFailed),
      // Of viewed runs only — see RELIABILITY_EVENTS comment.
      monitorRunFailRate: rate(monitorRunsFailed, monitorRunsViewed.length),
      monitorRunsViewed: monitorRunsViewed.length,
      purchaseFailures: purchaseFailed,
      searchFailed,
      artifactFailed,
      imageFailed: imgFailed,
    };

    // Daily failure-rate series.
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dayOf = (e: MixpanelEvent) => formatDate(new Date(e.properties.time * 1000));
    const dailyData = days.map((date) => {
      const de = events.filter((e) => dayOf(e) === date);
      const ok = de.filter((e) => ['Search_Performed', 'Search Performed', 'Search'].includes(e.event)).length;
      const failed = de.filter((e) => e.event === 'Search_Failed').length;
      return {
        date,
        searchFailRate: ok + failed > 0 ? Math.round((failed / (ok + failed)) * 1000) / 10 : 0,
        errors: de.filter((e) => e.event === 'Error_Encountered').length,
      };
    });

    // Top Error_Encountered messages.
    const errorMsgs = new Map<string, number>();
    for (const e of events.filter((ev) => ev.event === 'Error_Encountered')) {
      const msg = String(e.properties.error_type || e.properties.screen || 'Unknown');
      errorMsgs.set(msg, (errorMsgs.get(msg) || 0) + 1);
    }
    const topErrors = Array.from(errorMsgs)
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Connector degradations
    const degraded = new Map<string, number>();
    for (const e of events.filter((ev) => ev.event === 'Connector_Status_Degraded')) {
      const c = String(e.properties.connector_id || 'Unknown');
      degraded.set(c, (degraded.get(c) || 0) + 1);
    }
    const connectorDegradations = Array.from(degraded)
      .map(([connector, count]) => ({ connector, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json(
      {
        kpis,
        dailyData,
        topErrors,
        connectorDegradations,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching reliability metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reliability metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
