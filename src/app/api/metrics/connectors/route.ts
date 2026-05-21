// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
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
const ALL_CONNECTOR_EVENTS = [
  ...CONNECT_EVENTS,
  OAUTH_CALLBACK_EVENT,
  OPERATION_EVENT,
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

    const [allEvents, prevAllEvents] = await Promise.all([
      fetchMixpanelEvents(dateRange.from, dateRange.to),
      fetchMixpanelEvents(previousFrom, previousTo).catch(() => []),
    ]);

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

    // ── Funnel: Start → Succeed → First Operation ────────────────────
    // "First operation" counts unique users who completed at least one
    // operation — drop-off from connect-succeeded shows whether new
    // connections actually get used.
    const usersWithOperation = new Set<string>();
    for (const e of operationEvents) {
      if (e.properties.status === 'completed') {
        usersWithOperation.add(e.properties.distinct_id);
      }
    }
    const funnelTop = totalConnectStarted || 1;
    const connectorsFunnel = [
      {
        name: 'Connect Started',
        count: totalConnectStarted,
        percentage: 100,
        dropoff: 0,
      },
      {
        name: 'Connect Succeeded',
        count: totalConnectSucceeded,
        percentage:
          Math.round((totalConnectSucceeded / funnelTop) * 100 * 10) / 10,
        dropoff:
          totalConnectStarted > 0
            ? Math.round(
                Math.max(
                  0,
                  ((totalConnectStarted - totalConnectSucceeded) /
                    totalConnectStarted) *
                    100
                ) * 10
              ) / 10
            : 0,
      },
      {
        name: 'First Operation',
        count: usersWithOperation.size,
        percentage:
          Math.round((usersWithOperation.size / funnelTop) * 100 * 10) / 10,
        dropoff:
          totalConnectSucceeded > 0
            ? Math.round(
                Math.max(
                  0,
                  ((totalConnectSucceeded - usersWithOperation.size) /
                    totalConnectSucceeded) *
                    100
                ) * 10
              ) / 10
            : 0,
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
    const opCounts = new Map<string, number>();
    for (const e of operationEvents) {
      if (e.properties.status !== 'completed') continue;
      const id = displayConnector(e.properties.connector_id);
      const op =
        typeof e.properties.operation === 'string' && e.properties.operation
          ? e.properties.operation
          : 'unknown';
      const key = `${id} ${op}`;
      opCounts.set(key, (opCounts.get(key) ?? 0) + 1);
    }
    const operationBreakdown = Array.from(opCounts.entries())
      .map(([key, count]) => {
        const [connector, operation] = key.split(' ');
        return { connector, operation, count };
      })
      .sort((a, b) => b.count - a.count);

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
