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
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { subDays } from 'date-fns';

// Events for share creation (from chunk-web)
const SHARE_CREATION_EVENTS = [
  'Note_Shared',
  'Conversation_Shared',
  'Research_Report_Shared',
  'Collection_Shared',
];

// Events for shared page views (from chunk-notes)
const SHARED_VIEW_EVENTS = [
  'Shared_Note_Viewed',
  'Shared_Conversation_Viewed',
  'Shared_Research_Viewed',
];

// Event for save to chunk clicks
const SAVE_CLICK_EVENTS = [
  'Save_To_Chunk_Clicked',
];

const ALL_SHARING_EVENTS = [...SHARE_CREATION_EVENTS, ...SHARED_VIEW_EVENTS, ...SAVE_CLICK_EVENTS];

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

    const sharingEvents = filterEventsByType(events, ALL_SHARING_EVENTS);
    const shareCreationEvents = filterEventsByType(events, SHARE_CREATION_EVENTS);
    const sharedViewEvents = filterEventsByType(events, SHARED_VIEW_EVENTS);
    const saveClickEvents = filterEventsByType(events, SAVE_CLICK_EVENTS);

    // Summary counts
    const totalNotesShared = countEvents(shareCreationEvents, 'Note_Shared');
    const totalConversationsShared = countEvents(shareCreationEvents, 'Conversation_Shared');
    const totalResearchShared = countEvents(shareCreationEvents, 'Research_Report_Shared');
    const totalCollectionsShared = countEvents(shareCreationEvents, 'Collection_Shared');
    
    const totalSharedNoteViews = countEvents(sharedViewEvents, 'Shared_Note_Viewed');
    const totalSharedConversationViews = countEvents(sharedViewEvents, 'Shared_Conversation_Viewed');
    const totalSharedResearchViews = countEvents(sharedViewEvents, 'Shared_Research_Viewed');
    
    const totalSaveToChunkClicks = countEvents(saveClickEvents, 'Save_To_Chunk_Clicked');

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

    const prevShareCreation = filterEventsByType(previousEvents, SHARE_CREATION_EVENTS);
    const prevSharedViews = filterEventsByType(previousEvents, SHARED_VIEW_EVENTS);
    const prevSaveClicks = filterEventsByType(previousEvents, SAVE_CLICK_EVENTS);

    const noteSharedTrend = calculateTrend(totalNotesShared, countEvents(prevShareCreation, 'Note_Shared'));
    const conversationSharedTrend = calculateTrend(totalConversationsShared, countEvents(prevShareCreation, 'Conversation_Shared'));
    const researchSharedTrend = calculateTrend(totalResearchShared, countEvents(prevShareCreation, 'Research_Report_Shared'));
    
    const prevTotalViews = countEvents(prevSharedViews, 'Shared_Note_Viewed') + 
                          countEvents(prevSharedViews, 'Shared_Conversation_Viewed') + 
                          countEvents(prevSharedViews, 'Shared_Research_Viewed');
    const currentTotalViews = totalSharedNoteViews + totalSharedConversationViews + totalSharedResearchViews;
    const sharedViewsTrend = calculateTrend(currentTotalViews, prevTotalViews);
    
    const saveClickTrend = calculateTrend(totalSaveToChunkClicks, countEvents(prevSaveClicks, 'Save_To_Chunk_Clicked'));

    // Calculated metrics
    const totalShares = totalNotesShared + totalConversationsShared + totalResearchShared + totalCollectionsShared;
    const totalViews = totalSharedNoteViews + totalSharedConversationViews + totalSharedResearchViews;
    const viewToShareRatio = totalShares > 0 ? (totalViews / totalShares) : 0;
    // Return as decimal ratio (0-1); StatCard's formatPercentage handles ×100
    const saveToChunkClickRate = totalViews > 0 ? (totalSaveToChunkClicks / totalViews) : 0;

    // Daily data for shares created over time
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const sharesCreatedOverTime = days.map((date) => {
      const dayEvents = shareCreationEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        note: dayEvents.filter((e) => e.event === 'Note_Shared').length,
        conversation: dayEvents.filter((e) => e.event === 'Conversation_Shared').length,
        research: dayEvents.filter((e) => e.event === 'Research_Report_Shared').length,
        collection: dayEvents.filter((e) => e.event === 'Collection_Shared').length,
      };
    });

    // Daily data for shared page views over time
    const sharedViewsOverTime = days.map((date) => {
      const dayEvents = sharedViewEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        note: dayEvents.filter((e) => e.event === 'Shared_Note_Viewed').length,
        conversation: dayEvents.filter((e) => e.event === 'Shared_Conversation_Viewed').length,
        research: dayEvents.filter((e) => e.event === 'Shared_Research_Viewed').length,
      };
    });

    // Sharing funnel: Shared → Viewed → Save Clicked (all real data from chunk-notes)
    const shareCreated = totalShares;
    const shareViewed = totalViews;
    const saveClicked = totalSaveToChunkClicks;

    const funnelTop = shareCreated || 1;
    const sharingFunnel = [
      { 
        name: 'Shared', 
        count: shareCreated, 
        percentage: 100, 
        dropoff: 0 
      },
      { 
        name: 'Viewed', 
        count: shareViewed, 
        percentage: Math.round((shareViewed / funnelTop) * 100 * 10) / 10,
        dropoff: shareCreated > 0 ? Math.round(Math.max(0, ((shareCreated - shareViewed) / shareCreated) * 100) * 10) / 10 : 0
      },
      { 
        name: 'Save Clicked', 
        count: saveClicked, 
        percentage: Math.round((saveClicked / funnelTop) * 100 * 10) / 10,
        dropoff: shareViewed > 0 ? Math.round(Math.max(0, ((shareViewed - saveClicked) / shareViewed) * 100) * 10) / 10 : 0
      },
    ];

    // Content type distribution (shares created)
    const contentTypeDistribution = [
      { name: 'Notes', value: totalNotesShared },
      { name: 'Conversations', value: totalConversationsShared },
      { name: 'Research', value: totalResearchShared },
      { name: 'Collections', value: totalCollectionsShared },
    ].filter(item => item.value > 0);

    // View-to-share ratio by type
    const viewToShareByType = [
      { 
        type: 'Notes', 
        shares: totalNotesShared, 
        views: totalSharedNoteViews,
        ratio: totalNotesShared > 0 ? (totalSharedNoteViews / totalNotesShared) : 0
      },
      { 
        type: 'Conversations', 
        shares: totalConversationsShared, 
        views: totalSharedConversationViews,
        ratio: totalConversationsShared > 0 ? (totalSharedConversationViews / totalConversationsShared) : 0
      },
      { 
        type: 'Research', 
        shares: totalResearchShared, 
        views: totalSharedResearchViews,
        ratio: totalResearchShared > 0 ? (totalSharedResearchViews / totalResearchShared) : 0
      },
    ];

    return NextResponse.json({
      totalNotesShared,
      totalConversationsShared,
      totalResearchShared,
      totalCollectionsShared,
      totalSharedNoteViews,
      totalSharedConversationViews,
      totalSharedResearchViews,
      totalSaveToChunkClicks,
      noteSharedTrend,
      conversationSharedTrend,
      researchSharedTrend,
      sharedViewsTrend,
      saveClickTrend,
      viewToShareRatio,
      saveToChunkClickRate,
      sharesCreatedOverTime,
      sharedViewsOverTime,
      sharingFunnel,
      contentTypeDistribution,
      viewToShareByType,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching sharing metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sharing metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}