// Required for Vercel — Mixpanel export API can take 15-30s on cache miss
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  fetchMixpanelEventsWithStatus,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getUniqueUsers,
  countEvents,
  buildSequentialFunnel,
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
  'Collection_Chat_Message_Sent',
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
    const { events: allEvents, dataUnavailable } = await fetchMixpanelEventsWithStatus(dateRange.from, dateRange.to);
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
    const totalChatMessages = countEvents(collectionEvents, 'Collection_Chat_Message_Sent');
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
    const chatMessagesTrend = calculateTrend(totalChatMessages, countEvents(prevCollections, 'Collection_Chat_Message_Sent'));
    const exportedTrend = calculateTrend(totalExported, countEvents(prevCollections, 'Collection_Exported'));
    const sharedTrend = calculateTrend(totalShared, countEvents(prevCollections, 'Collection_Shared'));

    // Collections funnel — sequential unique users: a user counts in a stage
    // only if they also reached every prior stage (monotonic non-increasing).
    // Created → Viewed → Chat Started (a session) → Shared (a chat made public).
    // "Exported" is intentionally omitted — no collection export feature exists
    // on any platform, so that event never fires.
    const collectionsFunnel = buildSequentialFunnel(collectionEvents, [
      { name: 'Created', eventName: 'Collection_Created' },
      { name: 'Viewed', eventName: 'Collection_Viewed' },
      { name: 'Chat Started', eventName: 'Collection_Chat_Started' },
      { name: 'Shared', eventName: 'Collection_Shared' },
    ]);

    // Daily activity
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = collectionEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      return {
        date,
        created: dayEvents.filter((e) => e.event === 'Collection_Created').length,
        viewed: dayEvents.filter((e) => e.event === 'Collection_Viewed').length,
        chatStarted: dayEvents.filter((e) => e.event === 'Collection_Chat_Started').length,
        chatMessages: dayEvents.filter((e) => e.event === 'Collection_Chat_Message_Sent').length,
      };
    });

    // URL management over time
    const urlManagement = days.map((date) => {
      const dayEvents = collectionEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      return {
        date,
        added: dayEvents.filter((e) => e.event === 'Collection_URL_Added').length,
        removed: dayEvents.filter((e) => e.event === 'Collection_URL_Removed').length,
      };
    });

    const response = NextResponse.json({
      dataUnavailable,
      totalCreated,
      totalViewed,
      totalUpdated,
      totalDeleted,
      totalURLsAdded,
      totalURLsRemoved,
      totalChatStarted,
      totalChatMessages,
      totalExported,
      totalShared,
      uniqueCollectionUsers,
      createdTrend,
      viewedTrend,
      chatStartedTrend,
      chatMessagesTrend,
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
