import type { MixpanelEvent } from '@/types/mixpanel';

function ingestionTime(event: MixpanelEvent): number {
  for (const field of ['$mp_api_timestamp_ms', 'mp_processing_time_ms']) {
    const value = event.properties[field];
    if ((typeof value === 'number' || typeof value === 'string') && value !== '') {
      const timestamp = Number(value);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return 0;
}

/**
 * Raw exports include ingestion duplicates that Mixpanel's reports suppress.
 * Match their four-part identity BEFORE normalizing legacy event names:
 * https://docs.mixpanel.com/reference/event-deduplication
 *
 * Different insert IDs remain separate, even for simultaneous native events.
 * Without a complete identity there is no safe basis for discarding an event.
 */
export function deduplicateMixpanelEvents(events: MixpanelEvent[]): MixpanelEvent[] {
  const unique: MixpanelEvent[] = [];
  const positions = new Map<string, number>();

  for (const event of events) {
    const { distinct_id: uid, time, $insert_id: insertId } = event.properties;
    if (
      typeof event.event !== 'string' || !event.event ||
      typeof uid !== 'string' || !uid ||
      typeof time !== 'number' || !Number.isFinite(time) ||
      typeof insertId !== 'string' || !insertId.trim()
    ) {
      unique.push(event);
      continue;
    }

    const key = JSON.stringify([event.event, uid, time, insertId]);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, unique.length);
      unique.push(event);
    } else if (ingestionTime(event) >= ingestionTime(unique[position])) {
      // Export order is not guaranteed. Prefer the latest ingestion, and the
      // last row when timestamps are equal or absent, without reordering users.
      unique[position] = event;
    }
  }

  return unique;
}
