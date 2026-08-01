import 'server-only';

import {
  fetchMixpanelEventsFilteredWithStatus,
  filterByPlatform,
  filterByUserType,
  type UserType,
} from '@/lib/mixpanel';
import { dedupeMixpanelEvents } from '@/lib/feature-activity';
import { ENGAGEMENT_EXPORT_EVENT_NAMES } from '@/lib/engagement';

export interface EngagementSnapshotOptions {
  dateRange: { from: string; to: string };
  platform: string;
  userType: UserType;
}

/**
 * One narrow, status-aware Mixpanel snapshot shared by every core Engagement
 * route. The event-list hash is identical, so concurrent requests reuse the
 * same memory/disk cache entry rather than downloading a full export.
 */
export async function getEngagementSnapshot({
  dateRange,
  platform,
  userType,
}: EngagementSnapshotOptions) {
  const fetchStatus = await fetchMixpanelEventsFilteredWithStatus(
    dateRange.from,
    dateRange.to,
    ENGAGEMENT_EXPORT_EVENT_NAMES,
  );
  const deduplicated = dedupeMixpanelEvents(fetchStatus.events);
  const platformFiltered = filterByPlatform(deduplicated, platform);
  const events = filterByUserType(platformFiltered, userType);

  return { events, fetchStatus };
}
