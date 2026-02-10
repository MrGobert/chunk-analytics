import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  getUniqueUsers,
  countEvents,
  calculateTrend,
  getLastUpdated,
  getPropertyDistribution,
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
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);

    // Count push notification events
    const permissionRequested = countEvents(events, 'Push_Permission_Requested');
    const permissionGranted = countEvents(events, 'Push_Permission_Granted');
    const permissionDenied = countEvents(events, 'Push_Permission_Denied');
    const notificationsOpened = countEvents(events, 'Push_Notification_Opened');

    // Calculate opt-in rate (granted / (granted + denied))
    const totalResponses = permissionGranted + permissionDenied;
    const optInRate = totalResponses > 0 ? (permissionGranted / totalResponses) * 100 : 0;

    // Calculate open rate (would need sent data from OneSignal, estimate based on unique users with opens)
    const usersWithOpens = getUniqueUsers(
      events.filter((e) => e.event === 'Push_Notification_Opened')
    ).size;

    // Get previous period for trends
    const rangeDays = range === '7d' ? 7 : range === '90d' ? 90 : 30;
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

    const previousRequested = countEvents(previousEvents, 'Push_Permission_Requested');
    const previousGranted = countEvents(previousEvents, 'Push_Permission_Granted');
    const previousOpened = countEvents(previousEvents, 'Push_Notification_Opened');

    const requestedTrend = calculateTrend(permissionRequested, previousRequested);
    const grantedTrend = calculateTrend(permissionGranted, previousGranted);
    const openedTrend = calculateTrend(notificationsOpened, previousOpened);

    // Daily data for charts
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = events.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      const dayRequested = dayEvents.filter((e) => e.event === 'Push_Permission_Requested').length;
      const dayGranted = dayEvents.filter((e) => e.event === 'Push_Permission_Granted').length;
      const dayDenied = dayEvents.filter((e) => e.event === 'Push_Permission_Denied').length;
      const dayOpened = dayEvents.filter((e) => e.event === 'Push_Notification_Opened').length;

      return {
        date,
        requested: dayRequested,
        granted: dayGranted,
        denied: dayDenied,
        opened: dayOpened,
      };
    });

    // Get open destinations distribution
    const openEvents = events.filter((e) => e.event === 'Push_Notification_Opened');
    const destinationDist = getPropertyDistribution(openEvents, 'destination');
    const destinations = Array.from(destinationDist.entries())
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => b.count - a.count);

    // Get permission request sources
    const requestEvents = events.filter((e) => e.event === 'Push_Permission_Requested');
    const sourceDist = getPropertyDistribution(requestEvents, 'source');
    const sources = Array.from(sourceDist.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // Permission funnel - all percentages relative to base (permissionRequested)
    const grantedPercentage = permissionRequested > 0 ? (permissionGranted / permissionRequested) * 100 : 0;
    const openedPercentage = permissionRequested > 0 ? (notificationsOpened / permissionRequested) * 100 : 0;

    const permissionFunnel = [
      { name: 'Permission Requested', count: permissionRequested, percentage: 100, dropoff: 0 },
      {
        name: 'Permission Granted',
        count: permissionGranted,
        percentage: grantedPercentage,
        dropoff: permissionRequested > 0 ? Math.max(0, ((permissionRequested - permissionGranted) / permissionRequested) * 100) : 0,
      },
      {
        name: 'Notification Opened',
        count: notificationsOpened,
        percentage: openedPercentage,
        dropoff: permissionGranted > 0 ? Math.max(0, ((permissionGranted - notificationsOpened) / permissionGranted) * 100) : 0,
      },
    ];

    // Hourly distribution of opens
    const hourlyOpens = new Map<number, number>();
    for (let i = 0; i < 24; i++) {
      hourlyOpens.set(i, 0);
    }
    for (const event of openEvents) {
      const hour = new Date(event.properties.time * 1000).getHours();
      hourlyOpens.set(hour, (hourlyOpens.get(hour) || 0) + 1);
    }
    const hourlyDistribution = Array.from(hourlyOpens.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    return NextResponse.json({
      // Summary stats
      permissionRequested,
      permissionGranted,
      permissionDenied,
      notificationsOpened,
      optInRate,
      usersWithOpens,
      
      // Trends
      requestedTrend,
      grantedTrend,
      openedTrend,
      
      // Charts data
      dailyData,
      destinations,
      sources,
      permissionFunnel,
      hourlyDistribution,
      
      // Meta
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching push metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch push metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
