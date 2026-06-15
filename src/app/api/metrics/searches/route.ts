// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  fetchMixpanelEventsWithStatus,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getPropertyDistribution,
  calculateTrend,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const { events: allEvents, dataUnavailable } = await fetchMixpanelEventsWithStatus(dateRange.from, dateRange.to);
    const platformFilteredEvents = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFilteredEvents, userType);

    // Include both old and new event names for backwards compatibility
    const searchEvents = filterEventsByType(events, ['Search Performed', 'Search', 'Search_Performed']);

    // Previous period for trend
    const rangeDays = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : range === '365d' ? 365 : 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    let previousEvents: Awaited<ReturnType<typeof fetchMixpanelEvents>> = [];
    try {
      const allPreviousEvents = await fetchMixpanelEvents(previousFrom, previousTo);
      const prevPlatformFiltered = filterByPlatform(allPreviousEvents, platform);
      previousEvents = filterByUserType(prevPlatformFiltered, userType);
    } catch {
      // Use empty array if previous period data unavailable
    }

    const prevSearchEvents = filterEventsByType(previousEvents, ['Search Performed', 'Search', 'Search_Performed']);
    const searchTrend = calculateTrend(searchEvents.length, prevSearchEvents.length);

    // Searches over time
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const searchesOverTime = days.map((date) => {
      const daySearches = searchEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });
      return { date, searches: daySearches.length };
    });

    // Search modes breakdown
    const modesDistribution = getPropertyDistribution(searchEvents, 'search_mode');
    const searchModes = Array.from(modesDistribution.entries())
      .map(([mode, count]) => ({ mode: mode || 'Auto', count }))
      .sort((a, b) => b.count - a.count);

    // Models used
    const modelsDistribution = getPropertyDistribution(searchEvents, 'model_used');
    const modelsUsed = Array.from(modelsDistribution.entries())
      .map(([model, count]) => ({ model: model || 'Default', count }))
      .sort((a, b) => b.count - a.count);

    // Context usage
    const withContext = searchEvents.filter((e) => e.properties.has_context === true).length;
    const withoutContext = searchEvents.length - withContext;
    const contextUsage = [
      { hasContext: true, count: withContext },
      { hasContext: false, count: withoutContext },
    ];

    // Hourly distribution
    const hourlyCount = new Array(24).fill(0);
    for (const event of searchEvents) {
      const hour = new Date(event.properties.time * 1000).getHours();
      hourlyCount[hour]++;
    }
    const hourlyDistribution = hourlyCount.map((count, hour) => ({ hour, count }));

    // ── Model mix over time (top 5 models, daily share) ──
    const topModels = modelsUsed.slice(0, 5).map((m) => m.model);
    const modelsOverTime = days.map((date) => {
      const row: Record<string, string | number> = { date };
      for (const m of topModels) row[m] = 0;
      for (const e of searchEvents) {
        if (formatDate(new Date(e.properties.time * 1000)) !== date) continue;
        const model = String(e.properties.model_used || 'Default');
        if (topModels.includes(model)) row[model] = (row[model] as number) + 1;
      }
      return row;
    });

    // ── AI response time p50/p90 by model ──
    const responseEvents = events.filter((e) => e.event === 'AI_Response_Time');
    const byModel = new Map<string, number[]>();
    for (const e of responseEvents) {
      const model = String(e.properties.model || e.properties.model_used || 'Default');
      const ms = Number(e.properties.duration_ms);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      if (!byModel.has(model)) byModel.set(model, []);
      byModel.get(model)!.push(ms);
    }
    const pct = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      // Nearest-rank: index = ceil(p/100 * n) - 1, clamped — avoids overstating p50/p90.
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
      return Math.round(sorted[idx]);
    };
    const responseTimes = Array.from(byModel.entries())
      .map(([model, arr]) => ({ model, p50: pct(arr, 50), p90: pct(arr, 90), count: arr.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ── Search reliability ──
    const failedCount = events.filter((e) => e.event === 'Search_Failed').length;
    const searchFailRate = searchEvents.length + failedCount > 0
      ? failedCount / (searchEvents.length + failedCount)
      : 0;

    const response = NextResponse.json({
      dataUnavailable,
      searchesOverTime,
      searchModes,
      modelsUsed,
      modelsOverTime,
      topModels,
      responseTimes,
      searchFailRate,
      failedCount,
      contextUsage,
      hourlyDistribution,
      totalSearches: searchEvents.length,
      searchTrend,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching search metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch search metrics' },
      { status: 500 }
    );
  }
}
