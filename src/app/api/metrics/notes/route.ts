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

const NOTES_EVENTS = [
  'Note_Created',
  'Note_Viewed',
  'Note_Saved',
  'Note_Deleted',
  'Note_Shared',
  'Note_Published',
  'Note_Uploaded_To_Documents',
  'Note_Writing_Tool_Used',
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

    const notesEvents = filterEventsByType(events, NOTES_EVENTS);

    // Summary counts
    const totalNotesCreated = countEvents(notesEvents, 'Note_Created');
    const totalNotesViewed = countEvents(notesEvents, 'Note_Viewed');
    const totalNotesSaved = countEvents(notesEvents, 'Note_Saved');
    const totalNotesDeleted = countEvents(notesEvents, 'Note_Deleted');
    const totalPublished = countEvents(notesEvents, 'Note_Published');
    const totalShared = countEvents(notesEvents, 'Note_Shared');
    const totalDocumentUploads = countEvents(notesEvents, 'Note_Uploaded_To_Documents');
    const uniqueNoteUsers = getUniqueUsers(notesEvents).size;
    const totalWritingToolUses = countEvents(notesEvents, 'Note_Writing_Tool_Used');

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

    const prevNotes = filterEventsByType(previousEvents, NOTES_EVENTS);
    const createdTrend = calculateTrend(totalNotesCreated, countEvents(prevNotes, 'Note_Created'));
    const viewedTrend = calculateTrend(totalNotesViewed, countEvents(prevNotes, 'Note_Viewed'));
    const savedTrend = calculateTrend(totalNotesSaved, countEvents(prevNotes, 'Note_Saved'));
    const publishedTrend = calculateTrend(totalPublished, countEvents(prevNotes, 'Note_Published'));
    const sharedTrend = calculateTrend(totalShared, countEvents(prevNotes, 'Note_Shared'));
    const writingToolTrend = calculateTrend(totalWritingToolUses, countEvents(prevNotes, 'Note_Writing_Tool_Used'));

    // Notes funnel: Created → Saved → Published → Shared (using unique users per step)
    const usersCreated = new Set(notesEvents.filter((e) => e.event === 'Note_Created').map((e) => e.properties.distinct_id));
    const usersSaved = new Set(notesEvents.filter((e) => e.event === 'Note_Saved').map((e) => e.properties.distinct_id));
    const usersPublished = new Set(notesEvents.filter((e) => e.event === 'Note_Published').map((e) => e.properties.distinct_id));
    const usersShared = new Set(notesEvents.filter((e) => e.event === 'Note_Shared').map((e) => e.properties.distinct_id));

    const createdCount = usersCreated.size;
    const savedCount = usersSaved.size;
    const publishedCount = usersPublished.size;
    const sharedCount = usersShared.size;

    const savedPct = createdCount > 0 ? (savedCount / createdCount) * 100 : 0;
    const publishedPct = createdCount > 0 ? (publishedCount / createdCount) * 100 : 0;
    const sharedPct = createdCount > 0 ? (sharedCount / createdCount) * 100 : 0;

    const notesFunnel = [
      { name: 'Created', count: createdCount, percentage: 100, dropoff: 0 },
      { name: 'Saved', count: savedCount, percentage: Math.min(savedPct, 100),
        dropoff: createdCount > 0 ? Math.max(0, ((createdCount - savedCount) / createdCount) * 100) : 0 },
      { name: 'Published', count: publishedCount, percentage: publishedPct,
        dropoff: savedCount > 0 ? Math.max(0, ((savedCount - publishedCount) / savedCount) * 100) : 0 },
      { name: 'Shared', count: sharedCount, percentage: sharedPct,
        dropoff: publishedCount > 0 ? Math.max(0, ((publishedCount - sharedCount) / publishedCount) * 100) : 0 },
    ];

    // Daily activity
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = notesEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        created: dayEvents.filter((e) => e.event === 'Note_Created').length,
        viewed: dayEvents.filter((e) => e.event === 'Note_Viewed').length,
        saved: dayEvents.filter((e) => e.event === 'Note_Saved').length,
      };
    });

    // Save trigger distribution (auto vs manual)
    const saveEvents = notesEvents.filter((e) => e.event === 'Note_Saved');
    const triggerDist = getPropertyDistribution(saveEvents, 'trigger');
    const saveTriggerDistribution = Array.from(triggerDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Writing tool distribution
    const writingToolEvents = notesEvents.filter((e) => e.event === 'Note_Writing_Tool_Used');
    const toolDist = getPropertyDistribution(writingToolEvents, 'tool_type');
    const writingToolDistribution = Array.from(toolDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Feature adoption: Published, Shared, Uploaded to Documents
    const featureAdoption = [
      { name: 'Published', value: totalPublished },
      { name: 'Shared', value: totalShared },
      { name: 'Uploaded to Docs', value: totalDocumentUploads },
    ];

    // Note survival rate (created vs deleted ratio) - measures notes kept, not user retention
    const retentionRate = totalNotesCreated > 0
      ? ((totalNotesCreated - totalNotesDeleted) / totalNotesCreated) * 100
      : 0;
    const retentionRateLabel = 'Note Survival Rate';

    // Document upload rate
    const documentUploadRate = totalNotesCreated > 0
      ? (totalDocumentUploads / totalNotesCreated) * 100
      : 0;

    return NextResponse.json({
      totalNotesCreated,
      totalNotesViewed,
      totalNotesSaved,
      totalNotesDeleted,
      totalPublished,
      totalShared,
      totalDocumentUploads,
      uniqueNoteUsers,
      totalWritingToolUses,
      createdTrend,
      viewedTrend,
      savedTrend,
      publishedTrend,
      sharedTrend,
      writingToolTrend,
      notesFunnel,
      dailyData,
      saveTriggerDistribution,
      writingToolDistribution,
      featureAdoption,
      retentionRate,
      retentionRateLabel,
      documentUploadRate,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching notes metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
