// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  fetchMixpanelEventsWithStatus,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  countEvents,
  calculateTrend,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

// Lifecycle events fired by chunk-web (`Connector_Connect_*`,
// `Connector_Disconnected`, `Connector_OAuth_Callback`) plus the
// per-operation events fired from chat (`Connector_Operation_Used`
// and the connector-specific helpers — Notion_* / Gamma_*).
const CONNECT_EVENTS = [
  'Connector_Connect_Started',
  'Connector_Connect_Succeeded',
  'Connector_Connect_Failed',
  'Connector_Disconnected',
];
const OAUTH_CALLBACK_EVENT = 'Connector_OAuth_Callback';
const OPERATION_EVENT = 'Connector_Operation_Used';
// Newer lifecycle events (web first; Apple clients are not yet instrumented).
const DISCONNECT_FAILED_EVENT = 'Connector_Disconnect_Failed';
const STATUS_DEGRADED_EVENT = 'Connector_Status_Degraded';
const SETTINGS_VIEWED_EVENT = 'Connector_Settings_Viewed';
const ALL_CONNECTOR_EVENTS = [
  ...CONNECT_EVENTS,
  OAUTH_CALLBACK_EVENT,
  OPERATION_EVENT,
  DISCONNECT_FAILED_EVENT,
  STATUS_DEGRADED_EVENT,
  SETTINGS_VIEWED_EVENT,
  'Notion_Search_Used',
  'Notion_Page_Created',
  'Notion_Append_Performed',
  'Gamma_Generation_Started',
  'Gamma_Generation_Completed',
  'Gamma_Generation_Failed',
];

// Format a connector id for display ("notion" → "Notion"). Keeps
// unknown ids title-cased rather than guessing at a registry.
function displayConnector(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'Unknown';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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
    const rangeDaysMap: Record<string, number> = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '365d': 365,
    };
    const rangeDays = rangeDaysMap[range] ?? 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    const [current, prevAllEvents] = await Promise.all([
      fetchMixpanelEventsWithStatus(dateRange.from, dateRange.to),
      fetchMixpanelEvents(previousFrom, previousTo).catch(() => []),
    ]);
    const allEvents = current.events;
    // True only on a genuine fetch failure (no fresh data AND no stale cache) —
    // lets the UI show "data unavailable" instead of misleading zeros.
    const dataUnavailable = current.dataUnavailable;

    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);
    const connectorEvents = filterEventsByType(events, ALL_CONNECTOR_EVENTS);

    const prevPlatformFiltered = filterByPlatform(prevAllEvents, platform);
    const prevEvents = filterByUserType(prevPlatformFiltered, userType);
    const prevConnectorEvents = filterEventsByType(prevEvents, ALL_CONNECTOR_EVENTS);

    // ── Connect funnel ────────────────────────────────────────────────
    const totalConnectStarted = countEvents(connectorEvents, 'Connector_Connect_Started');
    const totalConnectSucceeded = countEvents(connectorEvents, 'Connector_Connect_Succeeded');
    const totalConnectFailed = countEvents(connectorEvents, 'Connector_Connect_Failed');
    const totalDisconnected = countEvents(connectorEvents, 'Connector_Disconnected');
    const totalDisconnectFailed = countEvents(connectorEvents, DISCONNECT_FAILED_EVENT);
    const totalStatusDegraded = countEvents(connectorEvents, STATUS_DEGRADED_EVENT);
    const totalSettingsViewed = countEvents(connectorEvents, SETTINGS_VIEWED_EVENT);

    // Operations completed via the generic cross-connector event. We
    // count the generic event (not the per-connector helpers) so totals
    // never double-count Notion_Page_Created + Connector_Operation_Used.
    const operationEvents = connectorEvents.filter((e) => e.event === OPERATION_EVENT);
    const totalOperations = operationEvents.filter(
      (e) => e.properties.status === 'completed'
    ).length;
    const totalOperationsFailed = operationEvents.filter(
      (e) => e.properties.status === 'failed'
    ).length;

    // ── Previous-period trends ────────────────────────────────────────
    const prevConnectStarted = countEvents(prevConnectorEvents, 'Connector_Connect_Started');
    const prevConnectSucceeded = countEvents(prevConnectorEvents, 'Connector_Connect_Succeeded');
    const prevOperationEvents = prevConnectorEvents.filter((e) => e.event === OPERATION_EVENT);
    const prevTotalOperations = prevOperationEvents.filter(
      (e) => e.properties.status === 'completed'
    ).length;

    // ── Rates ─────────────────────────────────────────────────────────
    const connectSuccessRate =
      totalConnectStarted > 0
        ? Math.min(1, Math.max(0, totalConnectSucceeded / totalConnectStarted))
        : 0;

    const oauthCallbacks = connectorEvents.filter((e) => e.event === OAUTH_CALLBACK_EVENT);
    const oauthSuccesses = oauthCallbacks.filter(
      (e) => e.properties.status === 'success'
    ).length;
    const oauthCallbackSuccessRate =
      oauthCallbacks.length > 0
        ? Math.min(1, Math.max(0, oauthSuccesses / oauthCallbacks.length))
        : 0;

    // ── Funnel: Viewed → Start → Succeed → First Operation ───────────
    // A unique-user funnel: each step counts distinct users so drop-off
    // reflects people, not raw event counts. "Settings Viewed" is the
    // awareness top. NB: connects can also start from the chat composer
    // (not just Settings), so Started can exceed Viewed — percentages are
    // clamped to [0,100] and the baseline falls back to starters when no
    // view events exist (e.g. before the web build that emits them ships).
    const usersWithOperation = new Set<string>();
    const uniqueViewers = new Set<string>();
    const uniqueStarters = new Set<string>();
    const uniqueSucceeders = new Set<string>();
    for (const e of connectorEvents) {
      const uid = e.properties.distinct_id as string | undefined;
      if (!uid) continue;
      if (e.event === SETTINGS_VIEWED_EVENT) uniqueViewers.add(uid);
      else if (e.event === 'Connector_Connect_Started') uniqueStarters.add(uid);
      else if (e.event === 'Connector_Connect_Succeeded') uniqueSucceeders.add(uid);
      else if (e.event === OPERATION_EVENT && e.properties.status === 'completed') {
        usersWithOperation.add(uid);
      }
    }
    const uniqueSettingsViewers = uniqueViewers.size;
    const funnelTop = uniqueViewers.size || uniqueStarters.size || 1;
    const funnelPct = (n: number) =>
      Math.min(100, Math.max(0, Math.round((n / funnelTop) * 100 * 10) / 10));
    const funnelDropoff = (prev: number, cur: number) =>
      prev > 0
        ? Math.round(Math.max(0, ((prev - cur) / prev) * 100) * 10) / 10
        : 0;
    const connectorsFunnel = [
      {
        name: 'Settings Viewed',
        count: uniqueViewers.size,
        percentage: funnelPct(uniqueViewers.size),
        dropoff: 0,
      },
      {
        name: 'Connect Started',
        count: uniqueStarters.size,
        percentage: funnelPct(uniqueStarters.size),
        dropoff: funnelDropoff(uniqueViewers.size, uniqueStarters.size),
      },
      {
        name: 'Connect Succeeded',
        count: uniqueSucceeders.size,
        percentage: funnelPct(uniqueSucceeders.size),
        dropoff: funnelDropoff(uniqueStarters.size, uniqueSucceeders.size),
      },
      {
        name: 'First Operation',
        count: usersWithOperation.size,
        percentage: funnelPct(usersWithOperation.size),
        dropoff: funnelDropoff(uniqueSucceeders.size, usersWithOperation.size),
      },
    ];

    // ── Connector breakdown (which app is used) ──────────────────────
    // Count completed operations per connector_id so the pie reflects
    // actual usage, not just connections (which can be one-and-done).
    const connectorCounts = new Map<string, number>();
    for (const e of operationEvents) {
      if (e.properties.status !== 'completed') continue;
      const id = displayConnector(e.properties.connector_id);
      connectorCounts.set(id, (connectorCounts.get(id) ?? 0) + 1);
    }
    const connectorBreakdown = Array.from(connectorCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // ── Operation breakdown (per connector × per operation) ─────────
    // Store structured values rather than packing "connector op" into a
    // string key — an operation containing a space would otherwise be
    // truncated by split(' ').
    const opCounts = new Map<
      string,
      { connector: string; operation: string; count: number }
    >();
    for (const e of operationEvents) {
      if (e.properties.status !== 'completed') continue;
      const connector = displayConnector(e.properties.connector_id);
      const operation =
        typeof e.properties.operation === 'string' && e.properties.operation
          ? e.properties.operation
          : 'unknown';
      const key = `${connector}::${operation}`;
      const existing = opCounts.get(key);
      if (existing) existing.count += 1;
      else opCounts.set(key, { connector, operation, count: 1 });
    }
    const operationBreakdown = Array.from(opCounts.values()).sort(
      (a, b) => b.count - a.count
    );

    // ── Daily activity (connects, operations, disconnects) ──────────
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyActivity = days.map((date) => {
      let connects = 0;
      let operations = 0;
      let disconnects = 0;
      for (const e of connectorEvents) {
        const eventDate = formatDate(new Date((e.properties.time as number) * 1000));
        if (eventDate !== date) continue;
        if (e.event === 'Connector_Connect_Succeeded') connects++;
        else if (e.event === 'Connector_Disconnected') disconnects++;
        else if (
          e.event === OPERATION_EVENT &&
          e.properties.status === 'completed'
        ) {
          operations++;
        }
      }
      return { date, connects, operations, disconnects };
    });

    // ── Top error messages (Connect_Failed + OAuth error + op fail) ─
    const errorCounts = new Map<string, number>();
    for (const e of connectorEvents) {
      let msg: unknown = null;
      if (e.event === 'Connector_Connect_Failed') {
        msg = e.properties.error_message;
      } else if (
        e.event === OAUTH_CALLBACK_EVENT &&
        e.properties.status === 'error'
      ) {
        msg = e.properties.error_message;
      } else if (e.event === 'Gamma_Generation_Failed') {
        msg = e.properties.error_message;
      } else if (e.event === DISCONNECT_FAILED_EVENT) {
        msg = e.properties.error_message;
      } else if (e.event === STATUS_DEGRADED_EVENT) {
        msg = e.properties.error_message;
      }
      if (typeof msg === 'string' && msg.trim()) {
        const trimmed = msg.length > 80 ? `${msg.slice(0, 77)}…` : msg;
        errorCounts.set(trimmed, (errorCounts.get(trimmed) ?? 0) + 1);
      }
    }
    const topErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ── Unique users with any connector activity ─────────────────────
    const uniqueConnectedUsers = new Set<string>(
      connectorEvents.map((e) => e.properties.distinct_id as string)
    ).size;

    const response = NextResponse.json({
      totalConnectStarted,
      totalConnectSucceeded,
      totalConnectFailed,
      totalDisconnected,
      totalDisconnectFailed,
      totalStatusDegraded,
      totalSettingsViewed,
      uniqueSettingsViewers,
      totalOperations,
      totalOperationsFailed,
      uniqueConnectedUsers,
      connectSuccessRate,
      oauthCallbackSuccessRate,
      connectStartedTrend: calculateTrend(totalConnectStarted, prevConnectStarted),
      connectSucceededTrend: calculateTrend(totalConnectSucceeded, prevConnectSucceeded),
      operationsTrend: calculateTrend(totalOperations, prevTotalOperations),
      connectorsFunnel,
      connectorBreakdown,
      operationBreakdown,
      dailyActivity,
      topErrors,
      dateRange,
      platform,
      userType,
      dataUnavailable,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600'
    );
    return response;
  } catch (error) {
    console.error('Error fetching connectors metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch connectors metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
