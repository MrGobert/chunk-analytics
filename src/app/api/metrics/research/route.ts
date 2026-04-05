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

const RESEARCH_EVENTS = [
  'Research_Report_Initiated',
  'Research_Report_Completed',
  'Research_Report_Viewed',
  'Research_Report_Deleted',
  'Research_Report_Exported',
  'Research_History_Viewed',
  'Research_Settings_Changed',
  'Research_Report_Added_To_Collection',
  'Research_Report_Filtered',
  'Research_Report_Shared',
  'Research_Published',
];

const REPORT_TYPES = ['deep', 'research_report', 'detailed_report', 'outline_report', 'resource_report'];

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

    const researchEvents = filterEventsByType(events, RESEARCH_EVENTS);

    // Summary counts
    const totalReportsInitiated = countEvents(researchEvents, 'Research_Report_Initiated');
    const totalReportsCompleted = countEvents(researchEvents, 'Research_Report_Completed');
    const completionRate = totalReportsInitiated > 0
      ? Math.min(1, Math.max(0, totalReportsCompleted / totalReportsInitiated))
      : 0;
    const totalReportsViewed = countEvents(researchEvents, 'Research_Report_Viewed');
    const totalExports = countEvents(researchEvents, 'Research_Report_Exported');
    const totalShares = countEvents(researchEvents, 'Research_Report_Shared');
    const uniqueResearchUsers = getUniqueUsers(researchEvents).size;

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

    const prevResearch = filterEventsByType(previousEvents, RESEARCH_EVENTS);
    const initiatedTrend = calculateTrend(totalReportsInitiated, countEvents(prevResearch, 'Research_Report_Initiated'));
    const completedTrend = calculateTrend(totalReportsCompleted, countEvents(prevResearch, 'Research_Report_Completed'));
    const viewedTrend = calculateTrend(totalReportsViewed, countEvents(prevResearch, 'Research_Report_Viewed'));
    const exportsTrend = calculateTrend(totalExports, countEvents(prevResearch, 'Research_Report_Exported'));
    const sharesTrend = calculateTrend(totalShares, countEvents(prevResearch, 'Research_Report_Shared'));

    // Report type distribution
    const initiatedEvents = researchEvents.filter((e) => e.event === 'Research_Report_Initiated');
    const typeDist = getPropertyDistribution(initiatedEvents, 'report_type');
    const reportTypeDistribution = Array.from(typeDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Research funnel — use unique users per step for accurate funnel percentages
    const usersInitiated = new Set(researchEvents.filter(e => e.event === 'Research_Report_Initiated').map(e => e.properties.distinct_id));
    const usersCompleted = new Set(researchEvents.filter(e => e.event === 'Research_Report_Completed').map(e => e.properties.distinct_id));
    const usersViewed = new Set(researchEvents.filter(e => e.event === 'Research_Report_Viewed').map(e => e.properties.distinct_id));
    const usersExportedOrShared = new Set(researchEvents.filter(e => e.event === 'Research_Report_Exported' || e.event === 'Research_Report_Shared').map(e => e.properties.distinct_id));

    const funnelBase = usersInitiated.size || 1;
    const completedPct = (usersCompleted.size / funnelBase) * 100;
    const viewedPct = (usersViewed.size / funnelBase) * 100;
    const exportedPct = (usersExportedOrShared.size / funnelBase) * 100;

    const researchFunnel = [
      { name: 'Initiated', count: usersInitiated.size, percentage: 100, dropoff: 0 },
      {
        name: 'Completed', count: usersCompleted.size, percentage: completedPct,
        dropoff: usersInitiated.size > 0 ? ((usersInitiated.size - usersCompleted.size) / usersInitiated.size) * 100 : 0
      },
      {
        name: 'Viewed', count: usersViewed.size, percentage: viewedPct,
        dropoff: usersCompleted.size > 0 ? ((usersCompleted.size - usersViewed.size) / usersCompleted.size) * 100 : 0
      },
      {
        name: 'Exported/Shared', count: usersExportedOrShared.size, percentage: exportedPct,
        dropoff: usersViewed.size > 0 ? ((usersViewed.size - usersExportedOrShared.size) / usersViewed.size) * 100 : 0
      },
    ];

    // Daily activity
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = researchEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      return {
        date,
        initiated: dayEvents.filter((e) => e.event === 'Research_Report_Initiated').length,
        completed: dayEvents.filter((e) => e.event === 'Research_Report_Completed').length,
        viewed: dayEvents.filter((e) => e.event === 'Research_Report_Viewed').length,
      };
    });

    // Report type popularity over time
    const reportTypeOverTime = days.map((date) => {
      const dayEvents = initiatedEvents.filter((e) => {
        const eventDate = formatDate(new Date(e.properties.time * 1000));
        return eventDate === date;
      });

      const result: Record<string, string | number> = { date };
      for (const type of REPORT_TYPES) {
        result[type] = dayEvents.filter((e) => String(e.properties.report_type) === type).length;
      }
      return result;
    });

    // Tone preferences
    const toneDist = getPropertyDistribution(initiatedEvents, 'tone');
    const tonePreferences = Array.from(toneDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Citation format preferences
    const citationDist = getPropertyDistribution(initiatedEvents, 'citation_format');
    const citationFormatPreferences = Array.from(citationDist.entries())
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);

    // Export format distribution
    const exportEvents = researchEvents.filter((e) => e.event === 'Research_Report_Exported');
    const exportDist = getPropertyDistribution(exportEvents, 'format');
    const exportFormatDistribution = Array.from(exportDist.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Average source count & word count from completed events
    const completedEvents = researchEvents.filter((e) => e.event === 'Research_Report_Completed');
    const totalSources = completedEvents.reduce((sum, e) => sum + (Number(e.properties.source_count) || 0), 0);
    const totalWords = completedEvents.reduce((sum, e) => sum + (Number(e.properties.word_count) || 0), 0);
    const averageSourceCount = completedEvents.length > 0 ? Math.round(totalSources / completedEvents.length) : 0;
    const averageWordCount = completedEvents.length > 0 ? Math.round(totalWords / completedEvents.length) : 0;

    const response = NextResponse.json({
      totalReportsInitiated,
      totalReportsCompleted,
      completionRate,
      totalReportsViewed,
      totalExports,
      totalShares,
      uniqueResearchUsers,
      initiatedTrend,
      completedTrend,
      viewedTrend,
      exportsTrend,
      sharesTrend,
      reportTypeDistribution,
      researchFunnel,
      dailyData,
      reportTypeOverTime,
      tonePreferences,
      citationFormatPreferences,
      exportFormatDistribution,
      averageSourceCount,
      averageWordCount,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Error fetching research metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
