// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getUniqueUsers,
  countEvents,
  calculateTrend,
  getLastUpdated,
  getPropertyDistribution,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

const ARTIFACT_EVENTS = [
  'Artifact_Created',
  'Artifact_Completed',
  'Artifact_Failed',
  'Artifact_Viewed',
  'Artifact_Deleted',
  'Artifact_Tab_Switched',
  'Artifact_Saved_To_Notes',
  'Artifact_Visual_Generated',
  'Artifact_Filtered',
  'Artifact_Searched',
  'Artifact_Onboarding_Viewed',
  'Artifact_Onboarding_Completed',
  'Artifact_Onboarding_Skipped',
  'Artifact_Batch_Started',
  'Artifact_Batch_Completed',
  'Artifact_File_Uploaded',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFilteredEvents = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFilteredEvents, userType);

    const artifactEvents = filterEventsByType(events, ARTIFACT_EVENTS);

    // Summary counts
    const totalCreated = countEvents(artifactEvents, 'Artifact_Created');
    const totalCompleted = countEvents(artifactEvents, 'Artifact_Completed');
    const totalFailed = countEvents(artifactEvents, 'Artifact_Failed');
    const totalViewed = countEvents(artifactEvents, 'Artifact_Viewed');
    const totalDeleted = countEvents(artifactEvents, 'Artifact_Deleted');
    const totalSavedToNotes = countEvents(artifactEvents, 'Artifact_Saved_To_Notes');
    const totalVisualsGenerated = countEvents(artifactEvents, 'Artifact_Visual_Generated');
    const totalBatchStarted = countEvents(artifactEvents, 'Artifact_Batch_Started');
    const totalFileUploads = countEvents(artifactEvents, 'Artifact_File_Uploaded');
    const uniqueArtifactUsers = getUniqueUsers(artifactEvents).size;
    const completionRate = totalCreated > 0 ? Math.min(1, Math.max(0, totalCompleted / totalCreated)) : 0;

    // Previous period for trends
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

    const prevArtifacts = filterEventsByType(previousEvents, ARTIFACT_EVENTS);
    const createdTrend = calculateTrend(totalCreated, countEvents(prevArtifacts, 'Artifact_Created'));
    const completedTrend = calculateTrend(totalCompleted, countEvents(prevArtifacts, 'Artifact_Completed'));
    const viewedTrend = calculateTrend(totalViewed, countEvents(prevArtifacts, 'Artifact_Viewed'));
    const savedToNotesTrend = calculateTrend(totalSavedToNotes, countEvents(prevArtifacts, 'Artifact_Saved_To_Notes'));
    const fileUploadsTrend = calculateTrend(totalFileUploads, countEvents(prevArtifacts, 'Artifact_File_Uploaded'));

    // Artifacts funnel: Created → Completed → Viewed → Saved to Notes (unique users per step)
    const usersCreated = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Created').map((e) => e.properties.distinct_id));
    const usersCompleted = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Completed').map((e) => e.properties.distinct_id));
    const usersViewed = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Viewed').map((e) => e.properties.distinct_id));
    const usersSaved = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Saved_To_Notes').map((e) => e.properties.distinct_id));

    const createdCount = usersCreated.size;
    const completedCount = usersCompleted.size;
    const viewedCount = usersViewed.size;
    const savedCount = usersSaved.size;

    const completedPct = createdCount > 0 ? (completedCount / createdCount) * 100 : 0;
    const viewedPct = createdCount > 0 ? (viewedCount / createdCount) * 100 : 0;
    const savedPct = createdCount > 0 ? (savedCount / createdCount) * 100 : 0;

    const artifactsFunnel = [
      { name: 'Created', count: createdCount, percentage: 100, dropoff: 0 },
      {
        name: 'Completed',
        count: completedCount,
        percentage: Math.min(completedPct, 100),
        dropoff: createdCount > 0 ? Math.min(100, Math.max(0, ((createdCount - completedCount) / createdCount) * 100)) : 0,
      },
      {
        name: 'Viewed',
        count: viewedCount,
        percentage: Math.min(viewedPct, 100),
        dropoff: completedCount > 0 ? Math.min(100, Math.max(0, ((completedCount - viewedCount) / completedCount) * 100)) : 0,
      },
      {
        name: 'Saved to Notes',
        count: savedCount,
        percentage: Math.min(savedPct, 100),
        dropoff: viewedCount > 0 ? Math.min(100, Math.max(0, ((viewedCount - savedCount) / viewedCount) * 100)) : 0,
      },
    ];

    // Daily activity
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = artifactEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      return {
        date,
        created: dayEvents.filter((e) => e.event === 'Artifact_Created').length,
        completed: dayEvents.filter((e) => e.event === 'Artifact_Completed').length,
        viewed: dayEvents.filter((e) => e.event === 'Artifact_Viewed').length,
      };
    });

    // Source type distribution (from Artifact_Created events)
    const createdEvents = artifactEvents.filter((e) => e.event === 'Artifact_Created');
    const sourceTypeDist = getPropertyDistribution(createdEvents, 'source_type');
    const sourceTypeDistribution = Array.from(sourceTypeDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Output type distribution (from Artifact_Created events — flatten the output_types array)
    const outputTypeCounts = new Map<string, number>();
    for (const event of createdEvents) {
      const outputTypes = event.properties.output_types;
      if (Array.isArray(outputTypes)) {
        for (const ot of outputTypes) {
          outputTypeCounts.set(String(ot), (outputTypeCounts.get(String(ot)) || 0) + 1);
        }
      }
    }
    const outputTypeDistribution = Array.from(outputTypeCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Tab switch distribution
    const tabEvents = artifactEvents.filter((e) => e.event === 'Artifact_Tab_Switched');
    const tabDist = getPropertyDistribution(tabEvents, 'tab');
    const tabSwitchDistribution = Array.from(tabDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Saved content type distribution
    const savedEvents = artifactEvents.filter((e) => e.event === 'Artifact_Saved_To_Notes');
    const savedDist = getPropertyDistribution(savedEvents, 'content_type');
    const savedContentTypeDistribution = Array.from(savedDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // File type distribution
    const fileEvents = artifactEvents.filter((e) => e.event === 'Artifact_File_Uploaded');
    const fileDist = getPropertyDistribution(fileEvents, 'file_type');
    const fileTypeDistribution = Array.from(fileDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Onboarding funnel
    const onboardingViewed = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Onboarding_Viewed').map((e) => e.properties.distinct_id));
    const onboardingCompleted = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Onboarding_Completed').map((e) => e.properties.distinct_id));
    const onboardingSkipped = new Set(artifactEvents.filter((e) => e.event === 'Artifact_Onboarding_Skipped').map((e) => e.properties.distinct_id));

    const onboardingViewedCount = onboardingViewed.size;
    const onboardingCompletedCount = onboardingCompleted.size;
    const onboardingSkippedCount = onboardingSkipped.size;

    const onboardingFunnel = [
      { name: 'Viewed', count: onboardingViewedCount, percentage: 100, dropoff: 0 },
      {
        name: 'Completed',
        count: onboardingCompletedCount,
        percentage: onboardingViewedCount > 0 ? Math.min((onboardingCompletedCount / onboardingViewedCount) * 100, 100) : 0,
        dropoff: onboardingViewedCount > 0 ? Math.min(100, Math.max(0, ((onboardingViewedCount - onboardingCompletedCount) / onboardingViewedCount) * 100)) : 0,
      },
      {
        name: 'Skipped',
        count: onboardingSkippedCount,
        percentage: onboardingViewedCount > 0 ? Math.min((onboardingSkippedCount / onboardingViewedCount) * 100, 100) : 0,
        dropoff: 0,
      },
    ];

    const response = NextResponse.json({
      totalCreated,
      totalCompleted,
      totalFailed,
      totalViewed,
      totalDeleted,
      totalSavedToNotes,
      totalVisualsGenerated,
      totalBatchStarted,
      totalFileUploads,
      uniqueArtifactUsers,
      completionRate,
      createdTrend,
      completedTrend,
      viewedTrend,
      savedToNotesTrend,
      fileUploadsTrend,
      artifactsFunnel,
      dailyData,
      sourceTypeDistribution,
      outputTypeDistribution,
      tabSwitchDistribution,
      savedContentTypeDistribution,
      fileTypeDistribution,
      onboardingFunnel,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching artifacts metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch artifacts metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
