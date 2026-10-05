/**
 * Who counts as at risk, wherever the dashboard says so: the Customers page's
 * At Risk card and At-Risk Customers list, and Pulse's alert, all count churn
 * intelligence's at-risk list (_compute_churn_intelligence in
 * server/analytics_api.py). The health score's tiers are named apart from it.
 */
export const AT_RISK_RULE = 'Inactive 7+ days, set to cancel, or trial ending within 3 days';

/** The Most Engaged list: paying customers who aren't at risk, health 40+. */
export const ENGAGED_RULE = 'Paying, active within 7 days, health 40+';

/** The health score's tiers (_health_status in server/analytics_api.py). */
export interface HealthTiers {
  healthy: number;
  fair: number;
  poor: number;
}

export function healthTierSummary(tiers: HealthTiers | undefined): string {
  if (!tiers) return 'No customers scored';
  // A payload cached before the tiers were renamed has none of these keys.
  return `${tiers.healthy ?? 0} healthy · ${tiers.fair ?? 0} fair · ${tiers.poor ?? 0} poor`;
}

interface EmailEngagementEvent {
  sentAt?: string;
  delivered?: boolean;
  opened?: boolean;
  clicked?: boolean;
  converted?: boolean;
}

export function emailEngagementScore(
  history: EmailEngagementEvent[],
): number | null {
  const trackable = history.filter(
    (email) => email.sentAt || email.delivered || email.opened || email.clicked,
  );
  if (trackable.length === 0) return null;

  const engaged = trackable.filter(
    (email) => email.opened || email.clicked || email.converted,
  ).length;
  return Math.round(engaged / trackable.length * 100);
}

export function recoverTenureFactor(
  tenure: number,
  recordedRecency: number,
  recoveredRecency: number,
): number {
  if (recordedRecency !== 0 || recoveredRecency <= 0) return tenure;
  return Math.min(100, tenure * 2);
}
