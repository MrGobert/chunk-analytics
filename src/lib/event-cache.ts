import { MixpanelEvent } from '@/types/mixpanel';

interface CachedEvents {
  events: MixpanelEvent[];
  timestamp: number;
}

const TTL = 5 * 60 * 1000; // 5 minutes

// Module-level cache — persists within a single serverless invocation
const eventCache = new Map<string, CachedEvents>();

function buildKey(fromDate: string, toDate: string): string {
  return `${fromDate}:${toDate}`;
}

export function getCachedEvents(fromDate: string, toDate: string): MixpanelEvent[] | null {
  const key = buildKey(fromDate, toDate);
  const cached = eventCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.timestamp > TTL) {
    eventCache.delete(key);
    return null;
  }

  return cached.events;
}

export function setCachedEvents(fromDate: string, toDate: string, events: MixpanelEvent[]): void {
  const key = buildKey(fromDate, toDate);
  eventCache.set(key, { events, timestamp: Date.now() });

  // Evict old entries to prevent unbounded growth
  if (eventCache.size > 20) {
    const now = Date.now();
    for (const [k, v] of eventCache) {
      if (now - v.timestamp > TTL) {
        eventCache.delete(k);
      }
    }
  }
}
