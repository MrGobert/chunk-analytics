import 'server-only';

import {
  fetchMixpanelEventsFilteredWithStatus,
  filterByPlatform,
  filterByUserType,
  type UserType,
} from '@/lib/mixpanel';
import {
  aggregateFeatureActivity,
  FEATURE_ACTIVITY_EXPORT_EVENT_NAMES,
} from '@/lib/feature-activity';
import { getDaysInRange, shiftDate } from '@/lib/utils';

export interface FeatureActivitySnapshotOptions {
  dateRange: { from: string; to: string };
  platform: string;
  userType: UserType;
}

/**
 * Fetch, filter, split, and aggregate the canonical feature snapshot shared by
 * Pulse and Features. Both endpoints therefore use the same export cache key,
 * user classification population, UTC boundaries, and insert-id deduplication.
 */
export async function getFeatureActivitySnapshot({
  dateRange,
  platform,
  userType,
}: FeatureActivitySnapshotOptions) {
  const currentDays = getDaysInRange(dateRange.from, dateRange.to);
  const priorTo = shiftDate(dateRange.from, -1);
  const priorFrom = shiftDate(priorTo, -(currentDays.length - 1));
  const priorDays = getDaysInRange(priorFrom, priorTo);

  // Pulse needs the same-weekday comparison even for the one-day view. Always
  // use that wider bound here so Pulse and Features retain the same cache key.
  const sameWeekdayFrom = shiftDate(dateRange.to, -7);
  const exportFrom = priorFrom < sameWeekdayFrom ? priorFrom : sameWeekdayFrom;
  const fetchStatus = await fetchMixpanelEventsFilteredWithStatus(
    exportFrom,
    dateRange.to,
    FEATURE_ACTIVITY_EXPORT_EVENT_NAMES,
  );
  const platformFiltered = filterByPlatform(fetchStatus.events, platform);
  const events = filterByUserType(platformFiltered, userType);
  const activity = aggregateFeatureActivity(events, { currentDays, priorDays });

  return {
    events,
    currentDays,
    priorDays,
    priorRange: { from: priorFrom, to: priorTo },
    activity,
    fetchStatus,
  };
}
