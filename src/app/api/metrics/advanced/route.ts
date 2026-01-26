import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  getUniqueUsers,
  getUniqueUsersByDate,
  filterEventsByType,
  getPropertyDistribution,
  getLastUpdated,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';
import { subDays, startOfMonth, endOfMonth, format, differenceInDays } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const events = filterByPlatform(allEvents, platform);

    // ============================================
    // DAU / MAU Ratio (Stickiness)
    // ============================================
    const usersByDate = getUniqueUsersByDate(events);
    const days = getDaysInRange(dateRange.from, dateRange.to);
    
    // Calculate DAU (average daily active users)
    const dailyUserCounts = days.map((date) => usersByDate.get(date)?.size || 0);
    const avgDAU = dailyUserCounts.reduce((a, b) => a + b, 0) / (dailyUserCounts.length || 1);
    
    // Calculate MAU (unique users in the period - approximation for 30-day period)
    const mau = getUniqueUsers(events).size;
    
    // DAU/MAU ratio (stickiness) - higher is better, 1.0 would mean every MAU user is active every day
    const dauMauRatio = mau > 0 ? avgDAU / mau : 0;

    // ============================================
    // Retention Rate (Day 1, Day 7, Day 30)
    // ============================================
    // Get users who had their first session in the first half of the date range
    const midDate = new Date(dateRange.from);
    midDate.setDate(midDate.getDate() + Math.floor(days.length / 2));
    
    const firstOpenEvents = events.filter((e) => e.event === '$ae_first_open');
    const newUserIds = new Set(firstOpenEvents.map((e) => e.properties.distinct_id));
    
    // Calculate retention by checking if new users came back
    const retention = {
      day1: 0,
      day7: 0,
      day30: 0,
      totalNewUsers: newUserIds.size,
    };

    if (newUserIds.size > 0) {
      // For each new user, check if they had any activity on day 1, 7, 30
      const userFirstDates = new Map<string, Date>();
      firstOpenEvents.forEach((e) => {
        const userId = e.properties.distinct_id;
        const date = new Date(e.properties.time * 1000);
        if (!userFirstDates.has(userId) || date < userFirstDates.get(userId)!) {
          userFirstDates.set(userId, date);
        }
      });

      let day1Retained = 0;
      let day7Retained = 0;
      let day30Retained = 0;

      userFirstDates.forEach((firstDate, userId) => {
        // Get all sessions for this user
        const userEvents = events.filter((e) => 
          e.properties.distinct_id === userId && 
          (e.event === '$ae_session' || e.event === 'Session_Started')
        );
        
        userEvents.forEach((e) => {
          const eventDate = new Date(e.properties.time * 1000);
          const daysDiff = differenceInDays(eventDate, firstDate);
          
          if (daysDiff === 1) day1Retained++;
          if (daysDiff >= 7 && daysDiff < 8) day7Retained++;
          if (daysDiff >= 30 && daysDiff < 31) day30Retained++;
        });
      });

      retention.day1 = (day1Retained / newUserIds.size) * 100;
      retention.day7 = (day7Retained / newUserIds.size) * 100;
      retention.day30 = (day30Retained / newUserIds.size) * 100;
    }

    // ============================================
    // Free vs Paid Users
    // ============================================
    // Users who completed a purchase are paid, others are free
    const purchaseEvents = filterEventsByType(events, [
      'Purchase Completed', 
      'Purchase_Completed',
      '$ae_iap'
    ]);
    const paidUserIds = new Set(purchaseEvents.map((e) => e.properties.distinct_id));
    const allUserIds = getUniqueUsers(events);
    
    const paidUsers = paidUserIds.size;
    const freeUsers = allUserIds.size - paidUsers;
    const paidPercentage = allUserIds.size > 0 ? (paidUsers / allUserIds.size) * 100 : 0;

    // ============================================
    // Traffic Sources (Web only)
    // ============================================
    const sessionEvents = events.filter((e) => 
      e.event === 'Session_Started' || e.event === 'Page_Viewed'
    );
    
    // Extract referrer domains
    const referrerCounts = new Map<string, number>();
    const utmSourceCounts = new Map<string, number>();
    
    sessionEvents.forEach((e) => {
      const referrer = e.properties.referrer as string;
      const utmSource = e.properties.utm_source as string;
      
      if (referrer) {
        try {
          const domain = new URL(referrer).hostname.replace('www.', '');
          referrerCounts.set(domain, (referrerCounts.get(domain) || 0) + 1);
        } catch {
          referrerCounts.set('direct', (referrerCounts.get('direct') || 0) + 1);
        }
      } else {
        referrerCounts.set('direct', (referrerCounts.get('direct') || 0) + 1);
      }
      
      if (utmSource) {
        utmSourceCounts.set(utmSource, (utmSourceCounts.get(utmSource) || 0) + 1);
      }
    });

    const trafficSources = Array.from(referrerCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const utmSources = Array.from(utmSourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ============================================
    // Guest vs Authenticated Users (Web)
    // ============================================
    const guestEvents = events.filter((e) => 
      e.properties.distinct_id?.toString().startsWith('guest-') ||
      e.properties.distinct_id === 'guest-user'
    );
    const guestUsers = new Set(guestEvents.map((e) => e.properties.distinct_id)).size;
    const authenticatedUsers = allUserIds.size - guestUsers;

    // ============================================
    // Average Session Duration
    // ============================================
    const sessionLengths = events
      .filter((e) => e.event === '$ae_session' && e.properties.$ae_session_length)
      .map((e) => e.properties.$ae_session_length as number)
      .filter((length) => length > 0 && length < 7200); // Filter outliers (< 2 hours)
    
    const avgSessionDuration = sessionLengths.length > 0
      ? sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length
      : 0;

    // ============================================
    // Searches per User
    // ============================================
    const searchEvents = filterEventsByType(events, ['Search Performed', 'Search', 'Search_Performed']);
    const searchesPerUser = allUserIds.size > 0 ? searchEvents.length / allUserIds.size : 0;

    // ============================================
    // Feature Adoption (first-time users of each feature)
    // ============================================
    const featureFirstUse = new Map<string, Set<string>>();
    const featureEvents = [
      { events: ['Note_Created', 'Notes'], name: 'Notes' },
      { events: ['Document_Uploaded', 'Documents'], name: 'Documents' },
      { events: ['Image_Generation_Started', 'Image Generation'], name: 'Image Generation' },
      { events: ['Collection_Created', 'Collections'], name: 'Collections' },
      { events: ['Memory_Added', 'AI Memory'], name: 'Memory' },
    ];

    featureEvents.forEach(({ events: eventNames, name }) => {
      const users = new Set(
        events
          .filter((e) => eventNames.includes(e.event))
          .map((e) => e.properties.distinct_id)
      );
      featureFirstUse.set(name, users);
    });

    const featureAdoption = Array.from(featureFirstUse.entries())
      .map(([feature, users]) => ({
        feature,
        users: users.size,
        adoptionRate: allUserIds.size > 0 ? (users.size / allUserIds.size) * 100 : 0,
      }))
      .sort((a, b) => b.adoptionRate - a.adoptionRate);

    return NextResponse.json({
      // Engagement Metrics
      dauMauRatio: Math.round(dauMauRatio * 100) / 100,
      avgDAU: Math.round(avgDAU),
      mau,
      avgSessionDuration: Math.round(avgSessionDuration),
      searchesPerUser: Math.round(searchesPerUser * 10) / 10,

      // Retention
      retention,

      // User Breakdown
      userBreakdown: {
        total: allUserIds.size,
        paid: paidUsers,
        free: freeUsers,
        paidPercentage: Math.round(paidPercentage * 10) / 10,
        guest: guestUsers,
        authenticated: authenticatedUsers,
      },

      // Traffic Sources (Web)
      trafficSources,
      utmSources,

      // Feature Adoption
      featureAdoption,

      // Meta
      dateRange,
      platform,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching advanced metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch advanced metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
