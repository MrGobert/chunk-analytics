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
// Event names are frozen as Monitor_* / Automation_* (shipped to production) even
// though the feature is now surfaced as "Automations" in the UI.
const CAPTURE_MONITOR_EVENTS = [
  // Automation lifecycle
  'Monitor_Created',
  'Monitor_Edited',
  'Monitor_Paused',
  'Monitor_Resumed',
  'Monitor_Deleted',
  'Monitor_RunNow',
  'Monitor_Run_Viewed',
  // Automation friction + funnel
  'Monitor_Limit_Hit',
  'Monitor_Paywall_Shown',
  'Monitor_Suggestion_Shown',
  'Monitor_Suggestion_Accepted',
  'Monitor_Suggestion_Dismissed',
  'Automation_Kind_Selected',
  'Automation_Recipe_Selected',
  'Automation_Plan_Previewed',
  // Capture + inbox triage
  'inbox_capture_created',
  'inbox_item_accepted',
  'inbox_item_discarded',
  'inbox_item_to_collection',
  // Capture setup + engagement
  'inbox_clipper_token_generated',
  'inbox_clipper_token_revoked',
  'inbox_email_alias_generated',
  'inbox_email_alias_disabled',
  'inbox_viewed',
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
    const kindMix = new Map<string, number>();
    const runStatusMix = new Map<string, number>();
    const kindSelectSource = new Map<string, number>();
    const planStepMix = new Map<string, number>();
    const recipes = new Map<string, number>();

    let monitorsCreated = 0;
    let capturesTotal = 0;
    let accepted = 0;
    let discarded = 0;
    let toCollection = 0;
    // Automation lifecycle
    let editedCount = 0;
    let pausedCount = 0;
    let resumedCount = 0;
    let deletedCount = 0;
    let runNowCount = 0;
    let runsBeforeDelete = 0;
    let runsViewed = 0;
    // Automation friction + suggestion funnel
    let limitHits = 0;
    let paywallsShown = 0;
    let suggestionShown = 0;
    let suggestionAccepted = 0;
    let suggestionDismissed = 0;
    // Capture setup + engagement
    let clipperGenerated = 0;
    let clipperRevoked = 0;
    let aliasGenerated = 0;
    let aliasDisabled = 0;
    let inboxViews = 0;

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
          bump(kindMix, String(p.kind ?? 'unknown'));
          bump(cadence, String(p.cadence ?? 'unknown'));
          bump(reportType, String(p.report_type ?? 'unknown'));
          const topic = String(p.query_truncated ?? '').trim();
          if (topic) bump(topics, topic);
          bump(monitorPlatform, platformOf(e));
          ensureDay(dayOf(t)).monitors++;
          break;
        }
        case 'Monitor_Edited':
          editedCount++;
          break;
        case 'Monitor_Paused':
          pausedCount++;
          break;
        case 'Monitor_Resumed':
          resumedCount++;
          break;
        case 'Monitor_Deleted':
          deletedCount++;
          runsBeforeDelete += Number(p.run_count ?? 0);
          break;
        case 'Monitor_RunNow':
          runNowCount++;
          break;
        case 'Monitor_Run_Viewed':
          runsViewed++;
          bump(runStatusMix, String(p.run_status ?? 'unknown'));
          break;
        case 'Monitor_Limit_Hit':
          limitHits++;
          break;
        case 'Monitor_Paywall_Shown':
          paywallsShown++;
          break;
        case 'Monitor_Suggestion_Shown':
          suggestionShown++;
          break;
        case 'Monitor_Suggestion_Accepted':
          suggestionAccepted++;
          break;
        case 'Monitor_Suggestion_Dismissed':
          suggestionDismissed++;
          break;
        case 'Automation_Kind_Selected':
          bump(kindSelectSource, String(p.source ?? 'unknown'));
          break;
        case 'Automation_Recipe_Selected': {
          const recipe = String(p.recipe_id ?? '').trim();
          if (recipe) bump(recipes, recipe);
          break;
        }
        case 'Automation_Plan_Previewed':
          bump(planStepMix, String(p.step_count ?? 'unknown'));
          break;
        case 'inbox_clipper_token_generated':
          clipperGenerated++;
          break;
        case 'inbox_clipper_token_revoked':
          clipperRevoked++;
          break;
        case 'inbox_email_alias_generated':
          aliasGenerated++;
          break;
        case 'inbox_email_alias_disabled':
          aliasDisabled++;
          break;
        case 'inbox_viewed':
          inboxViews++;
          break;
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

    const topRecipes = Array.from(recipes)
      .map(([recipe, count]) => ({ recipe, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const lifecycleActions = [
      { name: 'Created', value: monitorsCreated },
      { name: 'Edited', value: editedCount },
      { name: 'Paused', value: pausedCount },
      { name: 'Resumed', value: resumedCount },
      { name: 'Run Now', value: runNowCount },
      { name: 'Deleted', value: deletedCount },
    ].filter((a) => a.value > 0);

    const suggestionFunnel = buildFunnel([
      { name: 'Shown', count: suggestionShown },
      { name: 'Accepted', count: suggestionAccepted },
    ]);

    const suggestionOutcomes = [
      { name: 'Accepted', value: suggestionAccepted },
      { name: 'Dismissed', value: suggestionDismissed },
    ].filter((o) => o.value > 0);

    const captureSetup = [
      { name: 'Clipper connected', value: clipperGenerated },
      { name: 'Clipper revoked', value: clipperRevoked },
      { name: 'Email alias created', value: aliasGenerated },
      { name: 'Email alias disabled', value: aliasDisabled },
    ].filter((a) => a.value > 0);

    const suggestionAcceptRate = suggestionShown > 0 ? suggestionAccepted / suggestionShown : 0;
    const avgRunsBeforeDelete = deletedCount > 0 ? runsBeforeDelete / deletedCount : 0;

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
        // Automation lifecycle + funnel
        kindMix: toArr(kindMix),
        lifecycleActions,
        runStatusMix: toArr(runStatusMix),
        kindSelectSource: toArr(kindSelectSource),
        planStepMix: toArr(planStepMix),
        topRecipes,
        suggestionFunnel,
        suggestionOutcomes,
        suggestionAcceptRate,
        runsViewed,
        limitHits,
        paywallsShown,
        deletedCount,
        avgRunsBeforeDelete,
        // Capture setup + engagement
        captureSetup,
        inboxViews,
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
