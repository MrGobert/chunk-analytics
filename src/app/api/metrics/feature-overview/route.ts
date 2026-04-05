// Cross-feature summary — aggregates events and unique users per feature category
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  normalizeEventName,
  getLastUpdated,
  calculateTrend,
  UserType,
} from '@/lib/mixpanel';
import { MixpanelEvent } from '@/types/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

// Map canonical event names to feature categories for cross-feature comparison.
// All event names here must be canonical — legacy names are resolved via normalizeEventName().
const FEATURE_CATEGORIES: Record<string, string[]> = {
  Search: ['Search_Performed'],
  Research: ['Research_Report_Initiated', 'Research_Report_Completed', 'Research_Report_Viewed', 'Research_Report_Exported', 'Research_Report_Shared', 'Research_Report_Deleted', 'Research_History_Viewed', 'Research_Settings_Changed', 'Research_Report_Added_To_Collection', 'Research_Report_Filtered', 'Research_Published'],
  Notes: ['Note_Created', 'Note_Viewed', 'Note_Saved', 'Note_Shared', 'Note_Published', 'Note_Writing_Tool_Used', 'Note_Uploaded_To_Documents', 'Note_Deleted'],
  Collections: ['Collection_Created', 'Collection_Viewed', 'Collection_Chat_Started', 'Collection_Exported', 'Collection_Shared', 'Collection_URL_Added', 'Collection_Updated', 'Collection_Deleted', 'Collection_URL_Removed'],
  Artifacts: ['Artifact_Created', 'Artifact_Completed', 'Artifact_Viewed', 'Artifact_Saved_To_Notes', 'Artifact_File_Uploaded', 'Artifact_Failed', 'Artifact_Deleted', 'Artifact_Tab_Switched', 'Artifact_Visual_Generated', 'Artifact_Filtered', 'Artifact_Searched', 'Artifact_Onboarding_Viewed', 'Artifact_Onboarding_Completed', 'Artifact_Onboarding_Skipped', 'Artifact_Batch_Started', 'Artifact_Batch_Completed'],
  Documents: ['Document_Uploaded', 'Document_Viewed', 'Document_Deleted', 'Document_Attached'],
  'Image Gen': ['Image_Generation_Started', 'Image_Generation_Completed'],
  Memory: ['Memory_Viewed', 'Memory_Toggled', 'Memory_Added', 'Memory_Deleted', 'Memory_Management_Viewed'],
};

// Flatten all category events into a single set for efficient filtering
const ALL_FEATURE_EVENTS = new Set(Object.values(FEATURE_CATEGORIES).flat());

// Pre-built reverse lookup for O(1) categorization per event
const EVENT_TO_CATEGORY = new Map<string, string>();
for (const [category, events] of Object.entries(FEATURE_CATEGORIES)) {
  for (const event of events) {
    EVENT_TO_CATEGORY.set(event, category);
  }
}

function categorizeEvent(eventName: string): string | null {
  return EVENT_TO_CATEGORY.get(normalizeEventName(eventName)) ?? null;
}

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

    const [allEvents, prevAllEvents] = await Promise.all([
      fetchMixpanelEvents(dateRange.from, dateRange.to),
      fetchMixpanelEvents(previousFrom, previousTo).catch(() => []),
    ]);

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

    // Build response
    const features = Object.keys(FEATURE_CATEGORIES).map(category => {
      const stats = categoryStats.get(category)!;
      const prevTotal = previousCategoryTotals.get(category) || 0;
      return {
        name: category,
        totalEvents: stats.totalEvents,
        uniqueUsers: stats.uniqueUsers.size,
        trend: calculateTrend(stats.totalEvents, prevTotal),
      };
    }).sort((a, b) => b.totalEvents - a.totalEvents);

    return NextResponse.json({
      features,
      memoryEnabled: {
        uniqueUsers: memoryEnabledUsers.size,
        trend: calculateTrend(memoryEnabledUsers.size, prevMemoryEnabledUsers.size),
      },
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
