import 'server-only';
import { fetchMixpanelEventsFilteredWithStatus, filterByUserType, type UserType } from '@/lib/mixpanel';
import { aggregateJourneyMetrics, JOURNEY_EXPORT_EVENTS, journeyAccountResolver, journeyObservationRange } from '@/lib/journey';
import type { DateRange } from '@/types/mixpanel';

export async function getJourneySnapshot(options: { dateRange: DateRange; platform: string; userType?: UserType }) {
  const observation = journeyObservationRange(options.dateRange);
  const status = await fetchMixpanelEventsFilteredWithStatus(observation.from, observation.to, JOURNEY_EXPORT_EVENTS);
  // A cached export can only establish maturity through the time it was fetched.
  const fetchedAt = status.fetchedAt ? Date.parse(status.fetchedAt) / 1000 : observation.through;
  const observedThrough = Math.min(observation.through, fetchedAt);
  const accountOf = journeyAccountResolver(status.events);
  const accountEvents = status.events.map((event) => ({ ...event, properties: { ...event.properties, distinct_id: accountOf(event) } }));
  const accountIds = options.userType && options.userType !== 'all'
    ? new Set(filterByUserType(accountEvents, options.userType).map((event) => event.properties.distinct_id)) : undefined;
  const metrics = aggregateJourneyMetrics(status.events, { ...options, accountIds, observedThrough });
  return { events: status.events, status, metrics: { ...metrics, dataUnavailable: status.dataUnavailable, servedStale: status.servedStale } };
}
