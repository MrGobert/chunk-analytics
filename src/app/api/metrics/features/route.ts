import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  filterEventsByType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';

// Include both old and new event names for backwards compatibility
const FEATURE_EVENTS = [
  // Old event names (current iOS production)
  'Tab View',
  'Notes',
  'Documents',
  'Images',
  'Maps',
  'AI Memory',
  'Image Generation',
  'AISelection',
  'Memory Management Viewed',
  'Keyboard Shortcut Used',
  // New event names (AnalyticsService refactor)
  'Tab_Selected',
  'Note_Created',
  'Note_Viewed',
  'Note_Saved',
  'Document_Uploaded',
  'Document_Viewed',
  'Image_Generation_Started',
  'Image_Generation_Completed',
  'AI_Model_Selected',
  'Map_Viewed',
  'Memory_Viewed',
  'Memory_Management_Viewed',
  'Collection_Created',
  'Collection_Viewed',
  'Collection_Updated',
  'Collection_Deleted',
  'Collection_URL_Added',
  'Collection_Chat_Started',
  'Collection_Exported',
  // Search/Chat additions
  'Image_Attached',
  'Document_Attached',
  'Chart_Viewed',
  'Chat_Saved_As_Note',
  // Image generation
  'Image_Generation_Failed',
  // Documents
  'Document_Deleted',
  // Notes
  'Note_Created_From_Template',
  // Conversations
  'Conversation_Published',
  'Conversation_Shared',
  // Memory
  'Memory_Toggled',
  'Memory_Added',
  'Memory_Deleted',
  // Paywall/Guest
  'Feature_Limit_Reached',
  'Guest_Activity',
  // Web events
  'Page_Viewed',
  'Session_Started',
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

    const featureEvents = filterEventsByType(events, FEATURE_EVENTS);

    // Feature usage breakdown
    const featureCounts = new Map<string, number>();
    for (const event of featureEvents) {
      featureCounts.set(event.event, (featureCounts.get(event.event) || 0) + 1);
    }

    const featureUsage = Array.from(featureCounts.entries())
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count);

    // Feature adoption over time
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const featureOverTime = days.map((date) => {
      const dayEvents = featureEvents.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      const result: Record<string, string | number> = { date };
      for (const feature of FEATURE_EVENTS) {
        result[feature] = dayEvents.filter((e) => e.event === feature).length;
      }
      return result;
    });

    // Feature usage by user segment (by platform) - use same detection as filterByPlatform
    const segmentPlatforms = ['iOS', 'web', 'macOS', 'Unknown'];
    const featuresBySegment = segmentPlatforms.map((seg) => {
      const platformEvents = featureEvents.filter((e) => {
        const props = e.properties;
        const eventPlatform = props.platform || props.$os || '';
        const mpLib = props.mp_lib || '';

        if (seg === 'web') {
          return mpLib === 'web' || props.platform === 'web';
        }
        if (seg === 'iOS') {
          return eventPlatform === 'iOS' || props.$os === 'iOS' || props.$os === 'iPadOS';
        }
        if (seg === 'macOS') {
          return eventPlatform === 'macOS' || props.$os === 'macOS';
        }
        if (seg === 'Unknown') {
          const isWeb = mpLib === 'web' || props.platform === 'web';
          const isIOS = eventPlatform === 'iOS' || props.$os === 'iOS' || props.$os === 'iPadOS';
          const isMac = eventPlatform === 'macOS' || props.$os === 'macOS';
          return !isWeb && !isIOS && !isMac;
        }
        return false;
      });

      const counts = new Map<string, number>();
      for (const event of platformEvents) {
        counts.set(event.event, (counts.get(event.event) || 0) + 1);
      }

      return {
        segment: seg,
        features: Array.from(counts.entries())
          .map(([feature, count]) => ({ feature, count }))
          .sort((a, b) => b.count - a.count),
      };
    }).filter((s) => s.features.length > 0);

    return NextResponse.json({
      featureUsage,
      featureOverTime,
      featuresBySegment,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching feature metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feature metrics' },
      { status: 500 }
    );
  }
}
