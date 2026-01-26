import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterEventsByType,
  getPropertyDistribution,
  getLastUpdated,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';

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

    // Include both old and new event names for backwards compatibility
    const searchEvents = filterEventsByType(events, ['Search Performed', 'Search', 'Search_Performed']);

    // Searches over time
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const searchesOverTime = days.map((date) => {
      const daySearches = searchEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });
      return { date, searches: daySearches.length };
    });

    // Search modes breakdown
    const modesDistribution = getPropertyDistribution(searchEvents, 'search_mode');
    const searchModes = Array.from(modesDistribution.entries())
      .map(([mode, count]) => ({ mode: mode || 'Auto', count }))
      .sort((a, b) => b.count - a.count);

    // Models used
    const modelsDistribution = getPropertyDistribution(searchEvents, 'model_used');
    const modelsUsed = Array.from(modelsDistribution.entries())
      .map(([model, count]) => ({ model: model || 'Default', count }))
      .sort((a, b) => b.count - a.count);

    // Context usage
    const withContext = searchEvents.filter((e) => e.properties.has_context === true).length;
    const withoutContext = searchEvents.length - withContext;
    const contextUsage = [
      { hasContext: true, count: withContext },
      { hasContext: false, count: withoutContext },
    ];

    // Hourly distribution
    const hourlyCount = new Array(24).fill(0);
    for (const event of searchEvents) {
      const hour = new Date(event.properties.time * 1000).getHours();
      hourlyCount[hour]++;
    }
    const hourlyDistribution = hourlyCount.map((count, hour) => ({ hour, count }));

    return NextResponse.json({
      searchesOverTime,
      searchModes,
      modelsUsed,
      contextUsage,
      hourlyDistribution,
      totalSearches: searchEvents.length,
      dateRange,
      platform,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching search metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch search metrics' },
      { status: 500 }
    );
  }
}
