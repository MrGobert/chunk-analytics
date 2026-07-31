import { MixpanelEvent } from '@/types/mixpanel';

export const MARKETING_PAGE_EVENTS = ['Marketing_Page_Viewed', 'Page_Viewed'] as const;
export const MARKETING_CTA_EVENTS = [
  'Marketing_CTA_Clicked',
  'Create_Account_Clicked',
  'Try_For_Free_Clicked',
] as const;
export const SIGNUP_COMPLETE_EVENTS = [
  'Signup_Completed',
  'SignUp',
  'Account Created',
] as const;
export const PURCHASE_COMPLETE_EVENTS = [
  'Purchase_Completed',
  'Purchase Completed',
] as const;

const PAGE_LABELS: Record<string, string> = {
  home: 'Landing Page',
  features_index: 'Features Page',
  feature_artifacts: 'Artifacts Feature Page',
  feature_notes: 'Notes Feature Page',
  feature_wiki_links: 'Wiki Links Page',
  feature_collections: 'Collections Feature Page',
  feature_research: 'Research Feature Page',
  feature_automations: 'Automations Feature Page',
  memory: 'Memory Feature Page',
  signup: 'Signup Page',
  login: 'Login Page',
  pricing: 'Pricing Page',
};

const LEGACY_PAGE_IDS = Object.fromEntries(
  Object.entries(PAGE_LABELS).flatMap(([pageId, label]) => {
    const aliases = [[label, pageId]];
    if (pageId === 'feature_automations') aliases.push(['Monitors Feature Page', pageId]);
    return aliases;
  }),
);

export function marketingIdentityLinks(events: MixpanelEvent[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  const addCandidate = (identity: string, deviceId: string) => {
    if (!candidates.has(identity)) candidates.set(identity, new Set());
    candidates.get(identity)?.add(deviceId);
  };

  for (const event of events) {
    const deviceId = event.properties.$device_id;
    if (typeof deviceId !== 'string' || !deviceId) continue;
    addCandidate(event.properties.distinct_id, deviceId);
    const userId = event.properties.$user_id;
    if (typeof userId === 'string' && userId) addCandidate(userId, deviceId);
  }

  const links = new Map<string, string>();
  for (const [identity, deviceIds] of candidates) {
    if (deviceIds.size === 1) {
      links.set(identity, Array.from(deviceIds)[0]);
    }
  }
  return links;
}

export function marketingJourneyId(
  event: MixpanelEvent,
  identityLinks?: Map<string, string>,
): string {
  const deviceId = event.properties.$device_id;
  if (typeof deviceId === 'string' && deviceId) return deviceId;
  return identityLinks?.get(event.properties.distinct_id) || event.properties.distinct_id;
}

function compatibleProperties(
  left: MixpanelEvent,
  right: MixpanelEvent,
  propertyNames: string[],
): boolean {
  return propertyNames.every((property) => {
    const leftValue = left.properties[property];
    const rightValue = right.properties[property];
    return leftValue == null || rightValue == null || leftValue === rightValue;
  });
}

/**
 * Collapse one legacy event into its matching canonical dual-write. Matching
 * is one-to-one so an accidental extra canonical or legacy event remains
 * visible instead of being hidden as compatibility traffic.
 */
export function mergeCanonicalAndLegacy(
  events: MixpanelEvent[],
  canonicalName: string,
  legacyNames: readonly string[],
  matchProperties: string[] = [],
  windowSeconds = 3,
): MixpanelEvent[] {
  const canonical = events
    .filter((event) => event.event === canonicalName)
    .sort((a, b) => a.properties.time - b.properties.time);
  const legacy = events
    .filter((event) => legacyNames.includes(event.event))
    .sort((a, b) => a.properties.time - b.properties.time);
  const matchedCanonical = new Set<number>();
  const unmatchedLegacy: MixpanelEvent[] = [];

  for (const legacyEvent of legacy) {
    const matchIndex = canonical.findIndex(
      (canonicalEvent, index) =>
        !matchedCanonical.has(index) &&
        marketingJourneyId(canonicalEvent) === marketingJourneyId(legacyEvent) &&
        Math.abs(canonicalEvent.properties.time - legacyEvent.properties.time) <= windowSeconds &&
        compatibleProperties(canonicalEvent, legacyEvent, matchProperties),
    );
    if (matchIndex >= 0) matchedCanonical.add(matchIndex);
    else unmatchedLegacy.push(legacyEvent);
  }

  return [...canonical, ...unmatchedLegacy].sort(
    (a, b) => a.properties.time - b.properties.time,
  );
}

export function marketingPageViews(events: MixpanelEvent[]): MixpanelEvent[] {
  return mergeCanonicalAndLegacy(
    events,
    'Marketing_Page_Viewed',
    ['Page_Viewed'],
    ['page_path'],
  );
}

export function marketingCtaClicks(events: MixpanelEvent[]): MixpanelEvent[] {
  return mergeCanonicalAndLegacy(
    events,
    'Marketing_CTA_Clicked',
    ['Create_Account_Clicked', 'Try_For_Free_Clicked'],
    ['cta_id'],
  );
}

export function marketingFeaturePageVisits(events: MixpanelEvent[]): MixpanelEvent[] {
  const canonicalFeatureViews = events.filter((event) => {
    if (event.event !== 'Marketing_Page_Viewed') return false;
    const pageId = String(event.properties.page_id || '');
    return pageId.startsWith('feature_') || pageId === 'memory';
  });
  const legacyFeatureViews = events.filter(
    (event) => event.event === 'Feature_Page_Visited',
  );
  return mergeCanonicalAndLegacy(
    [...canonicalFeatureViews, ...legacyFeatureViews],
    'Marketing_Page_Viewed',
    ['Feature_Page_Visited'],
    ['page_path'],
  );
}

export function marketingFeatureKey(event: MixpanelEvent): string {
  if (event.event === 'Marketing_Page_Viewed') {
    return String(event.properties.page_id || 'Unknown').replace(/^feature_/, '');
  }
  return String(event.properties.page || 'Unknown')
    .replace(/^feature_/, '')
    .replace(/-/g, '_');
}

export function signupCompletions(events: MixpanelEvent[]): MixpanelEvent[] {
  return mergeCanonicalAndLegacy(
    events,
    'Signup_Completed',
    ['SignUp', 'Account Created'],
    ['method'],
  );
}

export function purchaseCompletions(events: MixpanelEvent[]): MixpanelEvent[] {
  return mergeCanonicalAndLegacy(
    events,
    'Purchase_Completed',
    ['Purchase Completed'],
    ['product_id'],
  );
}

export function marketingPageKey(event: MixpanelEvent): string {
  const canonicalId = event.properties.page_id;
  if (typeof canonicalId === 'string' && canonicalId) return canonicalId;

  const legacyName = event.properties.page_name;
  if (typeof legacyName !== 'string' || !legacyName) return 'unknown';
  return LEGACY_PAGE_IDS[legacyName] || legacyName;
}

export function marketingPageLabel(event: MixpanelEvent): string {
  const key = marketingPageKey(event);
  return PAGE_LABELS[key] || key;
}

export function marketingPageLabelFromKey(key: string): string {
  return PAGE_LABELS[key] || key;
}

export function marketingPageKeyFromValue(value: string): string {
  return LEGACY_PAGE_IDS[value] || value;
}

export function uniqueMarketingJourneys(
  events: MixpanelEvent[],
  identityLinks?: Map<string, string>,
): Set<string> {
  return new Set(events.map((event) => marketingJourneyId(event, identityLinks)));
}

export function orderedJourneyCounts(
  stages: { name: string; events: MixpanelEvent[] }[],
  identityLinks?: Map<string, string>,
): { name: string; count: number }[] {
  let previous: Set<string> | undefined;
  return stages.map((stage) => {
    const current = uniqueMarketingJourneys(stage.events, identityLinks);
    const reached = previous
      ? new Set(Array.from(current).filter((id) => previous?.has(id)))
      : current;
    previous = reached;
    return { name: stage.name, count: reached.size };
  });
}
