import { MixpanelEvent } from '@/types/mixpanel';
import { getCachedEventsAsync, setCachedEventsAsync, acquireLock, releaseLock, getStaleCachedEvents } from '@/lib/event-cache';
import { formatDate } from '@/lib/utils';

const CACHE_REVALIDATE_SECONDS = 300; // 5 minutes

// ============================================
// Event Name Normalization
// ============================================

/**
 * Maps duplicate/legacy event names to canonical names.
 * Mixpanel has accumulated multiple naming conventions over time —
 * this ensures consistent counting regardless of which name was used.
 */
const EVENT_NAME_MAP: Record<string, string> = {
  // Search variants → canonical
  'Search Performed': 'Search_Performed',
  'Search': 'Search_Performed',
  // Purchase variants → canonical
  'Purchase Completed': 'Purchase_Completed',
  '$ae_iap': 'Purchase_Completed',
  // Signup variants → canonical
  'SignUp': 'Signup_Completed',
  'Account Created': 'Signup_Completed',
  // Session variants → canonical
  'Session_Started': 'App_Session_Started',
  '$ae_session': 'App_Session_Started',
  // Paywall variants → canonical
  'Paywall Dismissed': 'Paywall_Dismissed',
  // Coach mark legacy names → canonical
  'collection_coach_mark_shown': 'Collection_Coach_Mark_Shown',
  'collection_coach_mark_tapped': 'Collection_Coach_Mark_Tapped',
  // Automations (formerly "Monitors") — the feature was renamed and the event
  // strings rebased to Automation_*. Older Apple clients (pre-rename builds that
  // users haven't updated yet) still emit the legacy Monitor_* names, so alias
  // them to the new canonical names to keep counts unified across app versions.
  'Monitor_Created': 'Automation_Created',
  'Monitor_Edited': 'Automation_Edited',
  'Monitor_Paused': 'Automation_Paused',
  'Monitor_Resumed': 'Automation_Resumed',
  'Monitor_Deleted': 'Automation_Deleted',
  'Monitor_RunNow': 'Automation_Run_Now',
  'Monitor_Run_Viewed': 'Automation_Run_Viewed',
  'Monitor_Limit_Hit': 'Automation_Limit_Hit',
  'Monitor_Paywall_Shown': 'Automation_Paywall_Shown',
  'Monitor_Suggestion_Shown': 'Automation_Suggestion_Shown',
  'Monitor_Suggestion_Accepted': 'Automation_Suggestion_Accepted',
  'Monitor_Suggestion_Dismissed': 'Automation_Suggestion_Dismissed',
};

/**
 * Normalize a single event name to its canonical form.
 */
export function normalizeEventName(eventName: string): string {
  return EVENT_NAME_MAP[eventName] || eventName;
}


// ============================================
// User Type Detection
// ============================================

export type UserType = 'all' | 'authenticated' | 'subscribers' | 'visitors';

// Events that indicate an authenticated user
const AUTH_EVENTS = [
  'Signup_Completed',
  'Login_Completed',
  'SignUp',
  'Account Created',
];

// Events that indicate a subscriber
const SUBSCRIBER_EVENTS = [
  'Purchase_Completed',
  'Purchase Completed',
  'Subscription_Started',
];

/**
 * Analyze events to categorize users by type
 * Returns a map of distinct_id -> user type
 */
export function categorizeUsers(events: MixpanelEvent[]): Map<string, 'visitor' | 'authenticated' | 'subscriber'> {
  const userCategories = new Map<string, 'visitor' | 'authenticated' | 'subscriber'>();

  // First pass: identify all users and their highest category
  for (const event of events) {
    const userId = event.properties.distinct_id;
    const currentCategory = userCategories.get(userId) || 'visitor';

    // Check for subscriber indicators (highest priority)
    if (
      SUBSCRIBER_EVENTS.includes(event.event) ||
      event.properties.$plan === 'Subscribed' ||
      event.properties.subscription_status === 'active' ||
      event.properties.is_pro === true
    ) {
      userCategories.set(userId, 'subscriber');
      continue;
    }

    // Check for authenticated user indicators (if not already subscriber).
    // Server-side events (cerebral) only fire for authenticated Firebase
    // uids, so their presence alone is auth evidence.
    if (currentCategory !== 'subscriber') {
      if (
        AUTH_EVENTS.includes(event.event) ||
        event.properties.$user_id !== undefined ||
        event.properties.user_id !== undefined ||
        event.properties.is_authenticated === true ||
        isServerEvent(event.properties)
      ) {
        userCategories.set(userId, 'authenticated');
        continue;
      }
    }

    // Default to visitor if not already categorized
    if (!userCategories.has(userId)) {
      userCategories.set(userId, 'visitor');
    }
  }

  return userCategories;
}

/**
 * Filter events by user type
 */
export function filterByUserType(
  events: MixpanelEvent[],
  userType: UserType
): MixpanelEvent[] {
  if (userType === 'all') return events;

  const userCategories = categorizeUsers(events);

  return events.filter((event) => {
    const userId = event.properties.distinct_id;
    const category = userCategories.get(userId) || 'visitor';

    switch (userType) {
      case 'authenticated':
        // Authenticated includes subscribers (subscribers are also authenticated)
        return category === 'authenticated' || category === 'subscriber';
      case 'subscribers':
        return category === 'subscriber';
      case 'visitors':
        return category === 'visitor';
      default:
        return true;
    }
  });
}

/**
 * Get user counts by type
 */
export function getUserCountsByType(events: MixpanelEvent[]): {
  total: number;
  visitors: number;
  authenticated: number;
  subscribers: number;
} {
  const userCategories = categorizeUsers(events);

  let visitors = 0;
  let authenticated = 0;
  let subscribers = 0;

  for (const category of userCategories.values()) {
    switch (category) {
      case 'visitor':
        visitors++;
        break;
      case 'authenticated':
        authenticated++;
        break;
      case 'subscriber':
        subscribers++;
        break;
    }
  }

  return {
    total: userCategories.size,
    visitors,
    authenticated: authenticated + subscribers, // Subscribers are also authenticated
    subscribers,
  };
}

/**
 * Get unique users filtered by user type
 */
export function getUniqueUsersByType(
  events: MixpanelEvent[],
  userType: UserType
): Set<string> {
  if (userType === 'all') {
    return new Set(events.map((e) => e.properties.distinct_id));
  }

  const userCategories = categorizeUsers(events);
  const filteredUsers = new Set<string>();

  for (const [userId, category] of userCategories.entries()) {
    switch (userType) {
      case 'authenticated':
        if (category === 'authenticated' || category === 'subscriber') {
          filteredUsers.add(userId);
        }
        break;
      case 'subscribers':
        if (category === 'subscriber') {
          filteredUsers.add(userId);
        }
        break;
      case 'visitors':
        if (category === 'visitor') {
          filteredUsers.add(userId);
        }
        break;
    }
  }

  return filteredUsers;
}

/**
 * Whether a distinct_id is a real, identified user (not a guest/anonymous/device id).
 * Shared by pulse (Weekly Active Creators) and power-users segmentation so the
 * "active user" population is defined the same way everywhere.
 */
export function isRealUser(uid: string | undefined | null): boolean {
  return !!uid && !uid.startsWith('guest-') && !uid.startsWith('$device:') && !uid.startsWith('anonymous');
}

const TEST_ACCOUNT_UID = 'I3JdK0ufgyN9So4rSOf4yxK1Drl1';

async function fetchMixpanelEventsFromAPI(
  fromDate: string,
  toDate: string,
  eventNames?: string[]
): Promise<MixpanelEvent[]> {
  const MIXPANEL_API_SECRET = process.env.MIXPANEL_API_SECRET;

  if (!MIXPANEL_API_SECRET) {
    throw new Error('MIXPANEL_API_SECRET environment variable is not set');
  }

  // Use btoa for base64 encoding (works in Edge runtime)
  const auth = btoa(`${MIXPANEL_API_SECRET}:`);

  let url = `https://data.mixpanel.com/api/2.0/export?from_date=${fromDate}&to_date=${toDate}`;
  if (eventNames && eventNames.length > 0) {
    // Server-side event filtering — Mixpanel accepts a JSON-encoded array.
    // Shrinks the export from ~39MB to kB–MB for funnel/cohort/activation work.
    url += `&event=${encodeURIComponent(JSON.stringify(eventNames))}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
    cache: 'no-store', // Manually handle caching to avoid 2MB limit restrictions
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mixpanel API error: ${response.status} - ${errorText}`);
  }

  const text = await response.text();
  const lines = text.trim().split('\n').filter(Boolean);
  const events: MixpanelEvent[] = lines.map((line) => JSON.parse(line));

  // Filter out the test account UID to prevent skewing analytics data
  const filteredEvents = events.filter((e) => e.properties.distinct_id !== TEST_ACCOUNT_UID);

  return filteredEvents;
}

/**
 * Short stable hash of a sorted event-name list, used as the cache-key variant
 * so each distinct filtered fetch gets its own cache entry.
 */
function hashEventNames(eventNames: string[]): string {
  const joined = [...eventNames].sort().join('|');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `ev${h.toString(36)}`;
}

/**
 * Whether the window ends before today (LA time). Past windows are immutable, so
 * their filtered exports can be cached far longer to spare the export rate limit.
 */
function isImmutablePast(toDate: string): boolean {
  // A window is only immutable once its end day is comfortably in the past.
  // Require it to end before *yesterday* so the final day's events have settled
  // (and been re-fetched) before we cache it under the 24h TTL — otherwise a
  // partial final-day export captured near midnight could be frozen for 24h.
  const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  return toDate < yesterday;
}

const IMMUTABLE_TTL = 24 * 60 * 60 * 1000; // 24h for closed historical windows
const FRESH_TTL = 5 * 60 * 1000; // 5 min for windows that include today

/**
 * Fetch only the named events for a window, with the same lock/disk/stale
 * machinery as the full export but a per-event-set cache key. Use this for any
 * heavy metric (funnels, cohorts, activation) — never pull the full 39MB export
 * when a handful of event names will do.
 */
export async function fetchMixpanelEventsFiltered(
  fromDate: string,
  toDate: string,
  eventNames: string[]
): Promise<MixpanelEvent[]> {
  const variant = hashEventNames(eventNames);
  const ttl = isImmutablePast(toDate) ? IMMUTABLE_TTL : FRESH_TTL;
  const cacheKey = `${fromDate}:${toDate}:${variant}`;

  // 1. Cache (memory → lock wait → disk), honouring the chosen TTL
  const cached = await getCachedEventsAsync(fromDate, toDate, variant, ttl);
  if (cached) return cached;

  // 2. Acquire the per-variant fetch lock
  const hasLock = acquireLock(fromDate, toDate, variant);
  if (!hasLock) {
    await new Promise((r) => setTimeout(r, 1000));
    const retry = await getCachedEventsAsync(fromDate, toDate, variant, ttl);
    if (retry) return retry;
    console.warn(`Filtered Mixpanel fetch timed out waiting for lock ${cacheKey}, falling back to stale.`);
  }

  // 3. Fetch from Mixpanel under the lock
  let events: MixpanelEvent[] | null = null;
  if (hasLock) {
    try {
      events = await fetchMixpanelEventsFromAPI(fromDate, toDate, eventNames);
      await setCachedEventsAsync(fromDate, toDate, events, variant);
    } catch (err) {
      console.error(`Filtered Mixpanel fetch failed for ${cacheKey}:`, err);
    } finally {
      releaseLock(fromDate, toDate, variant);
    }
  }
  if (events) return events;

  // 4. Stale fallback (ignore TTL) on rate-limit/timeout
  const stale = await getStaleCachedEvents(fromDate, toDate, variant);
  if (stale) {
    console.warn(`Serving ${stale.length} stale filtered events for ${cacheKey}.`);
    return stale;
  }

  // 5. Genuine total failure
  console.warn(`No cache available for filtered fetch ${cacheKey}. Returning empty list.`);
  return [];
}

export async function fetchMixpanelEventsWithStatus(
  fromDate: string,
  toDate: string
): Promise<{ events: MixpanelEvent[]; dataUnavailable: boolean }> {
  const cacheKey = `${fromDate}:${toDate}`;

  // 1. Ask the Event Cache for data (checks memory, waits for locks, checks disk)
  const cached = await getCachedEventsAsync(fromDate, toDate);
  if (cached) return { events: cached, dataUnavailable: false };

  // 2. Try to acquire the system file lock for this date range
  const hasLock = acquireLock(fromDate, toDate);

  if (!hasLock) {
    // If we missed the lock right after checking cache, wait a tiny bit and retry the async cache getter
    await new Promise(r => setTimeout(r, 1000));
    const retryCached = await getCachedEventsAsync(fromDate, toDate);
    if (retryCached) return { events: retryCached, dataUnavailable: false };
    console.warn(`Mixpanel fetch timed out waiting for lock ${cacheKey}, falling back to stale data.`);
  }

  // 3. We have the lock; fetch from Mixpanel
  let events: MixpanelEvent[] | null = null;
  if (hasLock) {
    try {
      events = await fetchMixpanelEventsFromAPI(fromDate, toDate);
      await setCachedEventsAsync(fromDate, toDate, events);
    } catch (err) {
      console.error(`Mixpanel API fetch failed for ${cacheKey}:`, err);
      // Fall through to grab stale data instead of crashing the dashboard
    } finally {
      releaseLock(fromDate, toDate);
    }
  }

  if (events) return { events, dataUnavailable: false };

  // 4. Fallback: serve stale data ignoring TTL if Mixpanel returns 429
  const stale = await getStaleCachedEvents(fromDate, toDate);
  if (stale) {
    console.warn(`Serving ${stale.length} stale events for ${cacheKey} due to API rate limits or timeout.`);
    return { events: stale, dataUnavailable: false };
  }

  // 5. Ultimate fallback: no fresh fetch AND no stale cache. This is a genuine
  // total failure, NOT a real "zero events" result — flag it so callers can
  // render a "data unavailable" state instead of misleading zeros.
  console.warn(`No stale cache available for ${cacheKey}. Returning empty events list (data unavailable).`);
  return { events: [], dataUnavailable: true };
}

/**
 * Backwards-compatible wrapper: returns just the events array (empty on a
 * total failure). Routes that don't surface a data-unavailable state keep
 * using this unchanged.
 */
export async function fetchMixpanelEvents(
  fromDate: string,
  toDate: string
): Promise<MixpanelEvent[]> {
  const { events } = await fetchMixpanelEventsWithStatus(fromDate, toDate);
  return events;
}

export function filterEventsByType(
  events: MixpanelEvent[],
  eventTypes: string[]
): MixpanelEvent[] {
  return events.filter((e) => eventTypes.includes(normalizeEventName(e.event)));
}

// ============================================
// Server-Side Event Platform Attribution
// ============================================

/**
 * Server-emitted events (cerebral's python Mixpanel lib, e.g.
 * inbox_capture_created) carry platform: 'server' / mp_lib: 'python'
 * instead of a client platform.
 */
export function isServerEvent(props: MixpanelEvent['properties']): boolean {
  return props.platform === 'server' || props.mp_lib === 'python';
}

/**
 * Map a server-side capture's `source` prop back to the client platform that
 * originated it. `email` and `app_intent` are deliberately unmapped —
 * app_intent fires from iOS AND macOS, email from anywhere — so those
 * captures only appear under the "all" platform filter.
 */
const SERVER_SOURCE_PLATFORM: Record<string, string> = {
  web: 'web',
  clipper: 'web', // Chrome extension = browser
  share_ios: 'iOS',
  share_mac: 'macOS',
};

export function serverEventPlatform(
  props: MixpanelEvent['properties']
): string | null {
  return SERVER_SOURCE_PLATFORM[String(props.source ?? '')] ?? null;
}

/**
 * Display platform for an event, folding server-side captures back to the
 * originating client platform via their `source` prop.
 */
export function platformOf(e: MixpanelEvent): string {
  const props = e.properties;
  if (isServerEvent(props)) {
    const derived = serverEventPlatform(props);
    if (derived === 'web') return 'Web';
    return derived ?? 'Other';
  }
  const os = (props.$os as string) || '';
  const mpLib = (props.mp_lib as string) || '';
  const platform = (props.platform as string) || '';
  if (mpLib === 'web' || platform === 'web') return 'Web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iPadOS') return 'iPadOS';
  if (os === 'iOS' || platform === 'iOS') return 'iOS';
  if (os === 'visionOS' || platform === 'visionOS') return 'visionOS';
  return 'Other';
}

export function filterByPlatform(
  events: MixpanelEvent[],
  platform: string
): MixpanelEvent[] {
  if (platform === 'all') return events;

  return events.filter((e) => {
    const props = e.properties;

    // Server-side events (captures) are attributed to the client platform
    // that originated them; unattributable sources (email, app_intent) are
    // excluded from any single-platform view.
    if (isServerEvent(props)) {
      const derived = serverEventPlatform(props);
      if (platform === 'iOS') return derived === 'iOS';
      return derived === platform;
    }

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
  return events.filter((e) => normalizeEventName(e.event) === eventType).length;
}

export function groupEventsByDate(
  events: MixpanelEvent[]
): Map<string, MixpanelEvent[]> {
  const grouped = new Map<string, MixpanelEvent[]>();

  for (const event of events) {
    const date = formatDate(new Date(event.properties.time * 1000));

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
    const date = formatDate(new Date(event.properties.time * 1000));

    if (!grouped.has(date)) {
      grouped.set(date, new Set());
    }
    grouped.get(date)!.add(event.properties.distinct_id);
  }

  return grouped;
}

/**
 * Calculate percentage change between two periods.
 * Returns null when previous=0 and current>0 (metric is "new" — no meaningful trend).
 * Frontend StatCard renders null as a "New" badge, which is intentional UX.
 */
export function calculateTrend(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return current > 0 ? null : 0;
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

/**
 * Normalize a referrer URL to its bare hostname for acquisition attribution.
 * Empty/unparseable → "(direct)". The marketing site's own domain is internal
 * navigation, not an external source, so it also folds into "(direct)".
 */
export function referrerHost(referrer: unknown): string {
  if (typeof referrer !== 'string' || referrer.trim() === '') return '(direct)';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (!host || host === 'chunkapp.com' || host.endsWith('.chunkapp.com')) return '(direct)';
    return host;
  } catch {
    return '(direct)';
  }
}

export function getLastUpdated(): string {
  return new Date().toISOString();
}
