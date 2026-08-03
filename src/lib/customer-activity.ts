import { dedupeMixpanelEvents } from '@/lib/feature-activity';
import { normalizeEventName } from '@/lib/mixpanel';
import type { CustomerUsageStats, MixpanelEvent } from '@/types/mixpanel';

const USAGE_EVENT_FIELDS: Readonly<Record<string, keyof CustomerUsageStats>> = {
  Search_Performed: 'searches',
  Document_Uploaded: 'documents',
  Image_Generation_Completed: 'images',
  Note_Created: 'notes',
  Collection_Created: 'collections',
  inbox_capture_created: 'captures',
  monitor_run_completed: 'automations',
  Artifact_Completed: 'artifacts',
};

export function eventBelongsToCustomer(event: MixpanelEvent, uid: string): boolean {
  const properties = event.properties;
  return (
    properties.distinct_id === uid ||
    properties.$user_id === uid ||
    properties.user_id === uid
  );
}

export function filterCustomerEvents(
  events: MixpanelEvent[],
  uid: string,
): MixpanelEvent[] {
  return dedupeMixpanelEvents(events.filter((event) => eventBelongsToCustomer(event, uid)));
}

export function countCustomerUsage(events: MixpanelEvent[]): CustomerUsageStats {
  const usage: CustomerUsageStats = {
    searches: 0,
    documents: 0,
    images: 0,
    notes: 0,
    collections: 0,
    captures: 0,
    automations: 0,
    artifacts: 0,
  };

  for (const event of events) {
    const field = USAGE_EVENT_FIELDS[normalizeEventName(event.event)];
    if (field) usage[field] = (usage[field] ?? 0) + 1;
  }

  return usage;
}

export function eventsOnOrAfter(
  events: MixpanelEvent[],
  date: string,
): MixpanelEvent[] {
  const cutoff = Date.parse(`${date}T00:00:00Z`) / 1000;
  return events.filter((event) => event.properties.time >= cutoff);
}
