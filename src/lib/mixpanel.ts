import { MixpanelEvent } from '@/types/mixpanel';
import { unstable_cache } from 'next/cache';

const CACHE_REVALIDATE_SECONDS = 300; // 5 minutes

async function fetchMixpanelEventsInternal(
  fromDate: string,
  toDate: string
): Promise<MixpanelEvent[]> {
  const MIXPANEL_API_SECRET = process.env.MIXPANEL_API_SECRET;
  
  if (!MIXPANEL_API_SECRET) {
    throw new Error('MIXPANEL_API_SECRET environment variable is not set');
  }

  // Use btoa for base64 encoding (works in Edge runtime)
  const auth = btoa(`${MIXPANEL_API_SECRET}:`);

  const url = `https://data.mixpanel.com/api/2.0/export?from_date=${fromDate}&to_date=${toDate}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
    // Use Next.js fetch cache with revalidation
    next: { revalidate: CACHE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mixpanel API error: ${response.status} - ${errorText}`);
  }

  const text = await response.text();
  const lines = text.trim().split('\n').filter(Boolean);
  const events: MixpanelEvent[] = lines.map((line) => JSON.parse(line));

  return events;
}

// Wrap with unstable_cache for additional server-side caching
export const fetchMixpanelEvents = unstable_cache(
  fetchMixpanelEventsInternal,
  ['mixpanel-events'],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ['mixpanel'] }
);

export function filterEventsByType(
  events: MixpanelEvent[],
  eventTypes: string[]
): MixpanelEvent[] {
  return events.filter((e) => eventTypes.includes(e.event));
}

export function filterByPlatform(
  events: MixpanelEvent[],
  platform: string
): MixpanelEvent[] {
  if (platform === 'all') return events;
  
  return events.filter((e) => {
    const props = e.properties;
    // Check various platform indicators
    const eventPlatform = props.platform || props.$os || '';
    const mpLib = props.mp_lib || '';
    
    if (platform === 'web') {
      // Web events use mixpanel-browser library OR have platform: 'web'
      return mpLib === 'web' || props.platform === 'web';
    }
    
    if (platform === 'iOS') {
      return eventPlatform === 'iOS' || props.$os === 'iOS' || props.$os === 'iPadOS';
    }
    
    if (platform === 'iPadOS') {
      return props.$os === 'iPadOS';
    }
    
    if (platform === 'macOS') {
      return eventPlatform === 'macOS' || props.$os === 'macOS';
    }
    
    if (platform === 'visionOS') {
      return eventPlatform === 'visionOS' || props.$os === 'visionOS';
    }
    
    return false;
  });
}

export function getUniqueUsers(events: MixpanelEvent[]): Set<string> {
  return new Set(events.map((e) => e.properties.distinct_id));
}

export function countEvents(events: MixpanelEvent[], eventType: string): number {
  return events.filter((e) => e.event === eventType).length;
}

export function groupEventsByDate(
  events: MixpanelEvent[]
): Map<string, MixpanelEvent[]> {
  const grouped = new Map<string, MixpanelEvent[]>();

  for (const event of events) {
    const date = new Date(event.properties.time * 1000)
      .toISOString()
      .split('T')[0];

    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(event);
  }

  return grouped;
}

export function getUniqueUsersByDate(
  events: MixpanelEvent[]
): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const event of events) {
    const date = new Date(event.properties.time * 1000)
      .toISOString()
      .split('T')[0];

    if (!grouped.has(date)) {
      grouped.set(date, new Set());
    }
    grouped.get(date)!.add(event.properties.distinct_id);
  }

  return grouped;
}

export function calculateTrend(
  current: number,
  previous: number
): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function getEventCounts(
  events: MixpanelEvent[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const event of events) {
    counts.set(event.event, (counts.get(event.event) || 0) + 1);
  }

  return counts;
}

export function getPropertyDistribution(
  events: MixpanelEvent[],
  property: string
): Map<string, number> {
  const distribution = new Map<string, number>();

  for (const event of events) {
    const value = String(event.properties[property] ?? 'Unknown');
    distribution.set(value, (distribution.get(value) || 0) + 1);
  }

  return distribution;
}

export function getLastUpdated(): string {
  return new Date().toISOString();
}
