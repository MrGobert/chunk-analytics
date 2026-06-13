// Cross-feature summary — aggregates events and unique users per feature category
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  fetchMixpanelEventsWithStatus,
  filterByPlatform,
  filterByUserType,
  normalizeEventName,
  getLastUpdated,
  calculateTrend,
  UserType,
} from '@/lib/mixpanel';
import { MixpanelEvent } from '@/types/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';
import { FEATURE_CATEGORIES, ALL_FEATURE_EVENTS, categorizeEvent } from '@/lib/feature-categories';

/** Compute the set of users whose latest Memory_Toggled state is ON (or who enabled via onboarding). */
function getMemoryEnabledUsers(toggleEvents: MixpanelEvent[], allEvents: MixpanelEvent[]): Set<string> {
  const userLatestToggle = new Map<string, { enabled: boolean; time: number }>();
  for (const event of toggleEvents) {
    if (event.event === 'Memory_Toggled') {
      const userId = event.properties.distinct_id;
      const time = event.properties.time as number;
      const enabled = event.properties.enabled === true || event.properties.enabled === 'true';
      const existing = userLatestToggle.get(userId);
      if (!existing || time > existing.time) {
        userLatestToggle.set(userId, { enabled, time });
      }
    }
  }
  const enabledUsers = new Set<string>();
  for (const [userId, { enabled }] of userLatestToggle) {
    if (enabled) enabledUsers.add(userId);
  }
  for (const event of allEvents) {
    if (event.event === 'Onboarding_Completed' && event.properties.source === 'memory_modal') {
      const userId = event.properties.distinct_id;
      const latestToggle = userLatestToggle.get(userId);
      if (!latestToggle || latestToggle.enabled) {
        enabledUsers.add(userId);
      }
    }
  }
  return enabledUsers;
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

    // Fetch current and previous periods concurrently
    const rangeDaysMap: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const rangeDays = rangeDaysMap[range] || 30;
    const previousFrom = formatDate(subDays(new Date(dateRange.from), rangeDays));
    const previousTo = formatDate(subDays(new Date(dateRange.to), rangeDays));

    const [current, prevAllEvents] = await Promise.all([
      fetchMixpanelEventsWithStatus(dateRange.from, dateRange.to),
      fetchMixpanelEvents(previousFrom, previousTo).catch(() => []),
    ]);
    const allEvents = current.events;
    const dataUnavailable = current.dataUnavailable;

    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);
    // Normalize event names before categorization so legacy names map to canonical categories
    const featureEvents = events.filter(e => ALL_FEATURE_EVENTS.has(normalizeEventName(e.event)));

    // Aggregate per category: total events + unique users
    const categoryStats = new Map<string, { totalEvents: number; uniqueUsers: Set<string> }>();
    for (const category of Object.keys(FEATURE_CATEGORIES)) {
      categoryStats.set(category, { totalEvents: 0, uniqueUsers: new Set() });
    }

    for (const event of featureEvents) {
      const category = categorizeEvent(event.event);
      if (!category) continue;
      const stats = categoryStats.get(category)!;
      stats.totalEvents++;
      stats.uniqueUsers.add(event.properties.distinct_id);
    }

    // Previous period trends
    const previousCategoryTotals = new Map<string, number>();
    const prevPlatform = filterByPlatform(prevAllEvents, platform);
    const prevEvents = filterByUserType(prevPlatform, userType);
    const prevFeatureEvents = prevEvents.filter(e => ALL_FEATURE_EVENTS.has(normalizeEventName(e.event)));

    for (const event of prevFeatureEvents) {
      const category = categorizeEvent(event.event);
      if (!category) continue;
      previousCategoryTotals.set(category, (previousCategoryTotals.get(category) || 0) + 1);
    }

    // Memory adoption — use extracted helper for both periods
    const memoryEnabledUsers = getMemoryEnabledUsers(featureEvents, events);
    const prevMemoryEnabledUsers = getMemoryEnabledUsers(prevFeatureEvents, prevEvents);

    // Stickiness (DAU/MAU) + adoption: per-category daily unique users.
    const daysInWindow = getDaysInRange(dateRange.from, dateRange.to);
    const numDays = Math.max(1, daysInWindow.length);
    const totalActiveUsers = new Set(events.map((e) => e.properties.distinct_id)).size;
    // category → day → Set(users)
    const dailyCatUsers = new Map<string, Map<string, Set<string>>>();
    for (const event of featureEvents) {
      const category = categorizeEvent(event.event);
      if (!category) continue;
      const day = formatDate(new Date(event.properties.time * 1000));
      if (!dailyCatUsers.has(category)) dailyCatUsers.set(category, new Map());
      const dayMap = dailyCatUsers.get(category)!;
      if (!dayMap.has(day)) dayMap.set(day, new Set());
      dayMap.get(day)!.add(event.properties.distinct_id);
    }

    // Build response
    const features = Object.keys(FEATURE_CATEGORIES).map(category => {
      const stats = categoryStats.get(category)!;
      const prevTotal = previousCategoryTotals.get(category) || 0;
      const mau = stats.uniqueUsers.size;
      const dayMap = dailyCatUsers.get(category);
      let avgDau = 0;
      if (dayMap) {
        let sum = 0;
        for (const set of dayMap.values()) sum += set.size;
        avgDau = sum / numDays;
      }
      return {
        name: category,
        totalEvents: stats.totalEvents,
        uniqueUsers: mau,
        trend: calculateTrend(stats.totalEvents, prevTotal),
        stickiness: mau > 0 ? avgDau / mau : 0,
        adoptionRate: totalActiveUsers > 0 ? mau / totalActiveUsers : 0,
      };
    }).sort((a, b) => b.totalEvents - a.totalEvents);

    return NextResponse.json({
      features,
      memoryEnabled: {
        uniqueUsers: memoryEnabledUsers.size,
        trend: calculateTrend(memoryEnabledUsers.size, prevMemoryEnabledUsers.size),
      },
      dataUnavailable,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching feature overview metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feature overview metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
