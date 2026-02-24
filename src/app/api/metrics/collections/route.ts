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

const COLLECTION_EVENTS = [
  'Collection_Created',
  'Collection_Viewed',
  'Collection_Updated',
  'Collection_Deleted',
  'Collection_URL_Added',
  'Collection_URL_Removed',
  'Collection_Chat_Started',
  'Collection_Exported',
  'Collection_Shared',
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

    const collectionEvents = filterEventsByType(events, COLLECTION_EVENTS);

    // Summary counts
    const totalCreated = countEvents(collectionEvents, 'Collection_Created');
    const totalViewed = countEvents(collectionEvents, 'Collection_Viewed');
    const totalUpdated = countEvents(collectionEvents, 'Collection_Updated');
    const totalDeleted = countEvents(collectionEvents, 'Collection_Deleted');
    const totalURLsAdded = countEvents(collectionEvents, 'Collection_URL_Added');
    const totalURLsRemoved = countEvents(collectionEvents, 'Collection_URL_Removed');
    const totalChatStarted = countEvents(collectionEvents, 'Collection_Chat_Started');
    const totalExported = countEvents(collectionEvents, 'Collection_Exported');
    const totalShared = countEvents(collectionEvents, 'Collection_Shared');
    const uniqueCollectionUsers = getUniqueUsers(collectionEvents).size;

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

    const prevCollections = filterEventsByType(previousEvents, COLLECTION_EVENTS);
    const createdTrend = calculateTrend(totalCreated, countEvents(prevCollections, 'Collection_Created'));
    const viewedTrend = calculateTrend(totalViewed, countEvents(prevCollections, 'Collection_Viewed'));
    const chatStartedTrend = calculateTrend(totalChatStarted, countEvents(prevCollections, 'Collection_Chat_Started'));
    const exportedTrend = calculateTrend(totalExported, countEvents(prevCollections, 'Collection_Exported'));
    const sharedTrend = calculateTrend(totalShared, countEvents(prevCollections, 'Collection_Shared'));

    // Collections funnel: Created → Viewed → Chat Started → Exported/Shared
    const exportedAndShared = totalExported + totalShared;
    const funnelTop = totalCreated || 1;
    const collectionsFunnel = [
      { name: 'Created', count: totalCreated, percentage: 100, dropoff: 0 },
      {
        name: 'Viewed',
        count: totalViewed,
        percentage: Math.round((totalViewed / funnelTop) * 100 * 10) / 10,
        dropoff: totalCreated > 0 ? Math.round(Math.max(0, ((totalCreated - totalViewed) / totalCreated) * 100) * 10) / 10 : 0,
      },
      {
        name: 'Chat Started',
        count: totalChatStarted,
        percentage: Math.round((totalChatStarted / funnelTop) * 100 * 10) / 10,
        dropoff: totalViewed > 0 ? Math.round(Math.max(0, ((totalViewed - totalChatStarted) / totalViewed) * 100) * 10) / 10 : 0,
      },
      {
        name: 'Exported/Shared',
        count: exportedAndShared,
        percentage: Math.round((exportedAndShared / funnelTop) * 100 * 10) / 10,
        dropoff: totalChatStarted > 0 ? Math.round(Math.max(0, ((totalChatStarted - exportedAndShared) / totalChatStarted) * 100) * 10) / 10 : 0,
      },
    ];

    // Daily activity
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = collectionEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        created: dayEvents.filter((e) => e.event === 'Collection_Created').length,
        viewed: dayEvents.filter((e) => e.event === 'Collection_Viewed').length,
        chatStarted: dayEvents.filter((e) => e.event === 'Collection_Chat_Started').length,
        exported: dayEvents.filter((e) => e.event === 'Collection_Exported').length,
      };
    });

    // URL management over time
    const urlManagement = days.map((date) => {
      const dayEvents = collectionEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        added: dayEvents.filter((e) => e.event === 'Collection_URL_Added').length,
        removed: dayEvents.filter((e) => e.event === 'Collection_URL_Removed').length,
      };
    });

    const response = NextResponse.json({
      totalCreated,
      totalViewed,
      totalUpdated,
      totalDeleted,
      totalURLsAdded,
      totalURLsRemoved,
      totalChatStarted,
      totalExported,
      totalShared,
      uniqueCollectionUsers,
      createdTrend,
      viewedTrend,
      chatStartedTrend,
      exportedTrend,
      sharedTrend,
      collectionsFunnel,
      dailyData,
      urlManagement,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching collections metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collections metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
