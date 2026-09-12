// Projects — the Workstation's Projects feature (web only, Pro to create, in
// beta since Sep 2026). Answers three questions: do people open Projects (the
// dock tile, or any path in), do they press "Start with an idea", and how many
// projects actually get created. Two of the signals ride on generic Workstation
// events and are narrowed by property here, because the Export API filters by
// event name only.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  buildSequentialFunnel,
  calculateTrend,
  expandEventNames,
  fetchMixpanelEventsFilteredWithStatus,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getLastUpdated,
  getPropertyDistribution,
  getUniqueUsers,
  groupEventsByDate,
  normalizeEventName,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, shiftDate } from '@/lib/utils';
import { ENGAGEMENT_USER_CONTEXT_EVENTS } from '@/lib/engagement';
import type { MixpanelEvent } from '@/types/mixpanel';

/** Every arrival into the Projects view: tile, sidebar row, ⌘K, deep link, card, back. */
const VIEW_EVENT = 'Workstation_View_Changed';
/** The dock tile itself (tile / keyboard / deep link). */
const TILE_EVENT = 'Workstation_Tool_Opened';
const START_EVENT = 'Project_Start_Clicked';
const CREATED_EVENT = 'Project_Created';
const OPENED_EVENT = 'Project_Opened';
const CONVERTED_EVENT = 'Project_Converted';

/**
 * Funnel entry: 'view' counts every path into Projects; 'tile' counts only
 * dock-tile opens. The view series is the Workstation's page-view series
 * (fetched for every view, current + prior window), so flip this to 'tile'
 * and drop VIEW_EVENT from the fetch if the export ever gets heavy.
 */
const FUNNEL_ENTRY = 'view' as 'view' | 'tile';

const PROJECT_EVENTS = [VIEW_EVENT, TILE_EVENT, START_EVENT, CREATED_EVENT, OPENED_EVENT, CONVERTED_EVENT];
// Classification context must ride along or userType filters see only visitors.
const PROJECTS_EXPORT_EVENT_NAMES = expandEventNames([
  ...PROJECT_EVENTS,
  ...ENGAGEMENT_USER_CONTEXT_EVENTS,
]);

const isNamed = (name: string) => (e: MixpanelEvent) => normalizeEventName(e.event) === name;
const isProjectsView = (e: MixpanelEvent) => isNamed(VIEW_EVENT)(e) && e.properties.view === 'projects';
const isProjectsTile = (e: MixpanelEvent) => isNamed(TILE_EVENT)(e) && e.properties.tool === 'projects';
const isGated = (e: MixpanelEvent) => e.properties.gated === true || e.properties.gated === 'true';
const isToProject = (e: MixpanelEvent) => e.properties.direction === 'to_project';

interface ProjectSlices {
  view: MixpanelEvent[];
  tile: MixpanelEvent[];
  start: MixpanelEvent[];
  created: MixpanelEvent[];
  opened: MixpanelEvent[];
  converted: MixpanelEvent[];
}

/** One pass per slice over an already platform/userType/name-scoped list. */
function sliceProjectEvents(events: MixpanelEvent[]): ProjectSlices {
  return {
    view: events.filter(isProjectsView),
    tile: events.filter(isProjectsTile),
    start: events.filter(isNamed(START_EVENT)),
    created: events.filter(isNamed(CREATED_EVENT)),
    opened: events.filter(isNamed(OPENED_EVENT)),
    converted: events.filter(isNamed(CONVERTED_EVENT)).filter(isToProject),
  };
}

function distribution(events: MixpanelEvent[], property: string): { via: string; count: number }[] {
  return Array.from(getPropertyDistribution(events, property))
    .map(([via, count]) => ({ via, count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);

    const days = getDaysInRange(dateRange.from, dateRange.to);
    const previousTo = shiftDate(dateRange.from, -1);
    const previousFrom = shiftDate(previousTo, -(days.length - 1));

    // Narrow export: six event names plus the classification context.
    const [currentStatus, previousStatus] = await Promise.all([
      fetchMixpanelEventsFilteredWithStatus(dateRange.from, dateRange.to, PROJECTS_EXPORT_EVENT_NAMES),
      fetchMixpanelEventsFilteredWithStatus(previousFrom, previousTo, PROJECTS_EXPORT_EVENT_NAMES),
    ]);

    const scope = (events: MixpanelEvent[]) =>
      filterEventsByType(filterByUserType(filterByPlatform(events, platform), userType), PROJECT_EVENTS);
    const current = sliceProjectEvents(scope(currentStatus.events));
    const previous = sliceProjectEvents(scope(previousStatus.events));

    const projectsOpened = current.view.length;
    const uniqueOpeners = getUniqueUsers(current.view).size;
    const tileOpens = current.tile.length;
    const startClicks = current.start.length;
    const paywallHits = current.start.filter(isGated).length;
    const projectsCreated = current.created.length;
    const uniqueCreators = getUniqueUsers(current.created).size;
    const convertedToProject = current.converted.length;
    const projectOpens = current.opened.length;
    const uniqueProjectOpeners = getUniqueUsers(current.opened).size;

    // null = "New" on the StatCard (prior window empty, or its fetch failed).
    const trend = (now: number, before: number) =>
      previousStatus.dataUnavailable ? null : calculateTrend(now, before);

    // The helper matches by event name only, so hand it the pre-filtered slices.
    const entryEvents = FUNNEL_ENTRY === 'view' ? current.view : current.tile;
    const funnel = buildSequentialFunnel(
      [...entryEvents, ...current.start, ...current.created],
      [
        { name: 'Opened Projects', eventName: FUNNEL_ENTRY === 'view' ? VIEW_EVENT : TILE_EVENT },
        { name: 'Start clicked', eventName: START_EVENT },
        { name: 'Project created', eventName: CREATED_EVENT },
      ],
    );

    const entryPaths = distribution(current.view, 'via');
    const createdByVia = distribution(current.created, 'via');
    const startClicksByGate = [
      { gate: 'Pro' as const, count: startClicks - paywallHits },
      { gate: 'Paywalled' as const, count: paywallHits },
    ];

    // Group once (O(n)) rather than filtering per day.
    const grouped = groupEventsByDate([...current.view, ...current.tile, ...current.start, ...current.created]);
    const dailyData = days.map((date) => {
      const dayEvents = grouped.get(date) || [];
      return {
        date,
        opened: dayEvents.filter(isProjectsView).length,
        tileOpens: dayEvents.filter(isProjectsTile).length,
        startClicks: dayEvents.filter(isNamed(START_EVENT)).length,
        created: dayEvents.filter(isNamed(CREATED_EVENT)).length,
      };
    });

    return NextResponse.json(
      {
        projectsOpened,
        uniqueOpeners,
        tileOpens,
        startClicks,
        paywallHits,
        projectsCreated,
        uniqueCreators,
        convertedToProject,
        projectOpens,
        uniqueProjectOpeners,
        projectsOpenedTrend: trend(projectsOpened, previous.view.length),
        tileOpensTrend: trend(tileOpens, previous.tile.length),
        startClicksTrend: trend(startClicks, previous.start.length),
        projectsCreatedTrend: trend(projectsCreated, previous.created.length),
        uniqueCreatorsTrend: trend(uniqueCreators, getUniqueUsers(previous.created).size),
        projectOpensTrend: trend(projectOpens, previous.opened.length),
        funnel,
        entryPaths,
        createdByVia,
        startClicksByGate,
        dailyData,
        dateRange,
        priorRange: { from: previousFrom, to: previousTo },
        platform,
        userType,
        dataUnavailable: currentStatus.dataUnavailable,
        servedStale: currentStatus.servedStale || previousStatus.servedStale,
        dataAsOf: currentStatus.fetchedAt,
        lastUpdated: getLastUpdated(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching projects metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch projects metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
