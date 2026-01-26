import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  getUniqueUsersByDate,
  getLastUpdated,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';
import { startOfWeek, startOfMonth, format } from 'date-fns';

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

    // DAU - Daily Active Users
    const usersByDate = getUniqueUsersByDate(events);
    const days = getDaysInRange(dateRange.from, dateRange.to);

    const dau = days.map((date) => ({
      date,
      users: usersByDate.get(date)?.size || 0,
    }));

    // WAU - Weekly Active Users
    const weeklyUsers = new Map<string, Set<string>>();
    for (const event of events) {
      const eventDate = new Date(event.properties.time * 1000);
      const weekStart = format(startOfWeek(eventDate), 'yyyy-MM-dd');

      if (!weeklyUsers.has(weekStart)) {
        weeklyUsers.set(weekStart, new Set());
      }
      weeklyUsers.get(weekStart)!.add(event.properties.distinct_id);
    }

    const wau = Array.from(weeklyUsers.entries())
      .map(([week, users]) => ({ week, users: users.size }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // MAU - Monthly Active Users
    const monthlyUsers = new Map<string, Set<string>>();
    for (const event of events) {
      const eventDate = new Date(event.properties.time * 1000);
      const monthStart = format(startOfMonth(eventDate), 'yyyy-MM');

      if (!monthlyUsers.has(monthStart)) {
        monthlyUsers.set(monthStart, new Set());
      }
      monthlyUsers.get(monthStart)!.add(event.properties.distinct_id);
    }

    const mau = Array.from(monthlyUsers.entries())
      .map(([month, users]) => ({ month, users: users.size }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Session Duration Distribution
    const sessionEvents = events.filter((e) => e.event === '$ae_session');
    const durations = sessionEvents
      .map((e) => e.properties.$ae_session_length || 0)
      .filter((d) => d > 0);

    const durationRanges = [
      { range: '0-30s', min: 0, max: 30 },
      { range: '30s-1m', min: 30, max: 60 },
      { range: '1-5m', min: 60, max: 300 },
      { range: '5-15m', min: 300, max: 900 },
      { range: '15-30m', min: 900, max: 1800 },
      { range: '30m+', min: 1800, max: Infinity },
    ];

    const sessionDurations = durationRanges.map(({ range, min, max }) => ({
      range,
      count: durations.filter((d) => d >= min && d < max).length,
    }));

    // Sessions per User
    const sessionsByUser = new Map<string, number>();
    for (const event of sessionEvents) {
      const userId = event.properties.distinct_id;
      sessionsByUser.set(userId, (sessionsByUser.get(userId) || 0) + 1);
    }

    const sessionCounts = Array.from(sessionsByUser.values());
    const sessionsPerUser = [
      { sessions: '1', users: sessionCounts.filter((c) => c === 1).length },
      { sessions: '2-3', users: sessionCounts.filter((c) => c >= 2 && c <= 3).length },
      { sessions: '4-5', users: sessionCounts.filter((c) => c >= 4 && c <= 5).length },
      { sessions: '6-10', users: sessionCounts.filter((c) => c >= 6 && c <= 10).length },
      { sessions: '10+', users: sessionCounts.filter((c) => c > 10).length },
    ];

    // Geographic Distribution
    const countryCount = new Map<string, number>();
    for (const event of events) {
      const country = event.properties.mp_country_code || 'Unknown';
      countryCount.set(country, (countryCount.get(country) || 0) + 1);
    }

    const totalEvents = events.length;
    const geographic = Array.from(countryCount.entries())
      .map(([country, users]) => ({
        country,
        users,
        percentage: totalEvents > 0 ? (users / totalEvents) * 100 : 0,
      }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 10);

    return NextResponse.json({
      dau,
      wau,
      mau,
      sessionDurations,
      sessionsPerUser,
      geographic,
      dateRange,
      platform,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching user metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user metrics' },
      { status: 500 }
    );
  }
}
