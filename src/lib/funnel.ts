import { MixpanelEvent } from '@/types/mixpanel';
import { normalizeEventName } from '@/lib/mixpanel';

export interface FunnelStep {
  name: string;
  count: number;
  percentage: number;
  dropoff: number;
}

/**
 * Unique users who fired any of the given (raw) event names.
 * Matches on the raw `e.event` to preserve existing acquisition behaviour.
 */
export function uniqueUsersFor(events: MixpanelEvent[], eventNames: string[]): Set<string> {
  return new Set(
    events
      .filter((e) => eventNames.includes(e.event))
      .map((e) => e.properties.distinct_id),
  );
}

/**
 * Like uniqueUsersFor but normalizes legacy event names first, so callers can
 * pass canonical names (e.g. "Signup_Completed") and still match "SignUp".
 */
export function uniqueUsersForNormalized(events: MixpanelEvent[], canonicalNames: string[]): Set<string> {
  const target = new Set(canonicalNames);
  return new Set(
    events
      .filter((e) => target.has(normalizeEventName(e.event)))
      .map((e) => e.properties.distinct_id),
  );
}

/**
 * Build a funnel with percentages relative to the FIRST step.
 * When the first step count is 0, all percentages are 0 — NOT 100%.
 */
export function buildFunnel(steps: { name: string; count: number }[]): FunnelStep[] {
  const base = steps[0]?.count ?? 0;
  return steps.map((step, i) => {
    const prevCount = i > 0 ? steps[i - 1].count : step.count;
    return {
      name: step.name,
      count: step.count,
      percentage: base > 0 ? Math.round((step.count / base) * 1000) / 10 : 0,
      dropoff:
        i === 0
          ? 0
          : prevCount > 0
            ? Math.round(((prevCount - step.count) / prevCount) * 1000) / 10
            : 0,
    };
  });
}
