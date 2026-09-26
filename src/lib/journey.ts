import type { DateRange, JourneyMetrics, MixpanelEvent } from '@/types/mixpanel';
import { deduplicateMixpanelEvents } from '@/lib/mixpanel-events';
import { platformOf } from '@/lib/mixpanel';
import { buildFunnel } from '@/lib/funnel';
import { formatDate, shiftDate } from '@/lib/utils';

export const NATIVE_PLATFORMS = ['iOS', 'iPadOS', 'macOS', 'visionOS'] as const;
export const JOURNEY_SIGNUP_EVENTS = ['Signup_Completed', 'SignUp', 'Account Created', 'onboarding_v2_account_created'];
export const JOURNEY_EXPORT_EVENTS = [
  ...JOURNEY_SIGNUP_EVENTS, '$identify', '$create_alias',
  'onboarding_v2_started', 'onboarding_v2_completed', 'onboarding_v2_screen_viewed',
  'onboarding_v2_skipped', 'onboarding_v2_authentication_completed',
  'Journey_Started', 'Journey_Tour_Viewed', 'Journey_Tour_Page_Viewed', 'Journey_Tour_Action_Selected',
  'Journey_Tour_Dismissed', 'Journey_Value_Completed', 'Journey_Value_Viewed',
  'Paywall_Viewed', 'Paywall_Dismissed', 'Paywall Dismissed', 'Plan_Selected',
  'Purchase_Initiated', 'Purchase_Completed', 'Purchase Completed', 'Purchase_Failed', 'Purchase_Cancelled',
];
const DAY = 86400;
const VALUE_KINDS = new Set(['chat', 'note', 'artifact', 'research', 'collection', 'automation', 'capture', 'siri', 'shortcuts']);
const PURCHASES = new Set(['Purchase_Completed', 'Purchase Completed']);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const explicitAccount = (event: MixpanelEvent) => text(event.properties.account_id) || text(event.properties.$user_id);

/** Account identity, never device identity: a shared device cannot merge accounts. */
export function journeyAccountResolver(events: MixpanelEvent[]): (event: MixpanelEvent) => string {
  const candidates = new Map<string, Set<string>>();
  const add = (identity: string, account: string) => {
    if (!identity || !account) return;
    if (!candidates.has(identity)) candidates.set(identity, new Set());
    candidates.get(identity)!.add(account);
  };
  for (const event of events) {
    const account = explicitAccount(event);
    if (account) add(event.properties.distinct_id, account);
  }
  // Authenticated distinct IDs often already are the Firebase account ID.
  for (const event of events) {
    if (event.event !== '$identify' && event.event !== '$create_alias') continue;
    const identified = text(event.properties.$identified_id) || text(event.properties.alias);
    const anonymous = text(event.properties.$anon_id) || event.properties.distinct_id;
    const known = candidates.get(identified);
    if (known?.size === 1) add(anonymous, [...known][0]);
    else if (identified && !known) add(anonymous, identified);
  }
  return (event) => {
    const account = explicitAccount(event);
    if (account) return account;
    const known = candidates.get(event.properties.distinct_id);
    return known?.size === 1 ? [...known][0] : event.properties.distinct_id;
  };
}

/** Sequential unique accounts; downstream events from unrelated users never count. */
export function orderedAccountCounts(steps: { name: string; events: MixpanelEvent[] }[], accountOf: (event: MixpanelEvent) => string) {
  let reached = new Map<string, number>();
  return steps.map((step, index) => {
    const next = new Map<string, number>();
    for (const event of [...step.events].sort((a, b) => a.properties.time - b.properties.time)) {
      const id = accountOf(event);
      if (!id || next.has(id)) continue;
      if (index === 0 || (reached.has(id) && event.properties.time >= reached.get(id)!)) next.set(id, event.properties.time);
    }
    reached = next;
    return { name: step.name, count: reached.size };
  });
}

export function journeyObservationRange(cohort: DateRange, now = Date.now() / 1000, days = 30) {
  const today = formatDate(new Date(now * 1000));
  const end = shiftDate(cohort.to, days);
  const to = end < today ? end : today;
  return { from: cohort.from, to, through: Math.min(now, Date.parse(`${shiftDate(to, 1)}T00:00:00Z`) / 1000) };
}

export function deviceFamilyOf(event: MixpanelEvent): string {
  const explicit = text(event.properties.device_family);
  if (explicit) return explicit;
  return ({ iOS: 'iPhone', iPadOS: 'iPad', macOS: 'Mac', visionOS: 'Vision Pro' } as Record<string, string>)[platformOf(event)] || 'unknown';
}

interface Value { time: number; kind: string; id: string }
/** Require explicit successful outcomes, never infer success from a sent prompt or an empty collection. */
export function deliveredJourneyValues(events: MixpanelEvent[]): Value[] {
  const ordered = [...events].sort((a, b) => a.properties.time - b.properties.time ||
    Number(b.event === 'Journey_Value_Completed') - Number(a.event === 'Journey_Value_Completed'));
  const completed = new Map<string, { event: MixpanelEvent; kind: string }>();
  const delivered = new Map<string, Value>();
  for (const event of ordered) {
    const id = text(event.properties.value_id);
    if (!id) continue;
    if (event.event === 'Journey_Value_Completed') {
      const kind = text(event.properties.value_kind);
      if (!VALUE_KINDS.has(kind) || event.properties.success === false || event.properties.is_empty === true ||
          ['failed', 'cancelled', 'canceled', 'empty'].includes(text(event.properties.status))) continue;
      if (!completed.has(id)) completed.set(id, { event, kind });
      if (event.properties.is_visible === true && !delivered.has(id)) delivered.set(id, { time: event.properties.time, kind, id });
    } else if (event.event === 'Journey_Value_Viewed' && !delivered.has(id)) {
      const outcome = completed.get(id);
      if (outcome) delivered.set(id, { time: event.properties.time, kind: outcome.kind, id });
    }
  }
  const uniqueObjects = new Map<string, Value>();
  for (const value of [...delivered.values()].sort((a, b) => a.time - b.time)) {
    let key = `${value.kind}:${value.id}`;
    if (value.kind === 'shortcuts' || value.kind === 'siri') {
      const separator = value.id.indexOf(':');
      const referenceKind = value.id.slice(0, separator);
      const kind = ({ report: 'research', monitor: 'automation', inbox: 'capture' } as Record<string, string>)[referenceKind] || referenceKind;
      if (separator > 0 && VALUE_KINDS.has(kind)) key = `${kind}:${value.id.slice(separator + 1)}`;
    }
    if (!uniqueObjects.has(key)) uniqueObjects.set(key, value);
  }
  return [...uniqueObjects.values()];
}

export function aggregateJourneyMetrics(raw: MixpanelEvent[], options: {
  dateRange: DateRange; platform?: string; observedThrough: number;
  accountIds?: Set<string>;
}): JourneyMetrics {
  const { dateRange, observedThrough } = options;
  const events = deduplicateMixpanelEvents(raw).filter((event) => Number.isFinite(event.properties.time) && event.properties.time <= observedThrough);
  const accountOf = journeyAccountResolver(events);
  const byAccount = new Map<string, MixpanelEvent[]>();
  const signups = new Map<string, MixpanelEvent>();
  for (const event of events) {
    const id = accountOf(event);
    if (!id) continue;
    if (!byAccount.has(id)) byAccount.set(id, []);
    byAccount.get(id)!.push(event);
    if (JOURNEY_SIGNUP_EVENTS.includes(event.event) && (!signups.has(id) || event.properties.time < signups.get(id)!.properties.time)) signups.set(id, event);
  }
  const rows = [...signups].flatMap(([id, signup]) => {
    const platform = platformOf(signup);
    const date = formatDate(new Date(signup.properties.time * 1000));
    if (!NATIVE_PLATFORMS.some((item) => item === platform) || date < dateRange.from || date > dateRange.to ||
        (options.platform && options.platform !== 'all' && platform !== options.platform) || (options.accountIds && !options.accountIds.has(id))) return [];
    const start = signup.properties.time;
    const activity = byAccount.get(id)!.filter((event) => event.properties.time >= start && event.properties.time <= start + 30 * DAY).sort((a, b) => a.properties.time - b.properties.time);
    const values = deliveredJourneyValues(activity);
    const first = values[0];
    const paywall = first && activity.find((event) => event.event === 'Paywall_Viewed' && event.properties.time >= first.time);
    const checkout = paywall && activity.find((event) => PURCHASES.has(event.event) && event.properties.time >= paywall.properties.time);
    const version = String(signup.properties.journey_version ?? activity.find((event) => event.properties.journey_version != null)?.properties.journey_version ?? 'legacy');
    return [{ id, start, platform, deviceFamily: deviceFamilyOf(signup), version, activity, values, first, paywall, checkout }];
  });
  const summary = (subset: typeof rows) => {
    // Old clients did not emit outcomes. Missing instrumentation cannot be
    // interpreted as failure, nor silently mixed into the new denominator.
    const instrumented = subset.filter((row) => row.version !== 'legacy');
    const eligible24 = instrumented.filter((row) => row.start + DAY <= observedThrough);
    const successful24 = eligible24.filter((row) => row.first && row.first.time <= row.start + DAY);
    const eligible7 = instrumented.filter((row) => row.start + 7 * DAY <= observedThrough);
    const nonChat = eligible7.filter((row) => row.values.some((value) => value.kind !== 'chat' && value.time <= row.start + 7 * DAY));
    const eligibleD7 = instrumented.filter((row) => row.start + 8 * DAY <= observedThrough);
    const returned = eligibleD7.filter((row) => row.values.some((value) => value.time >= row.start + 7 * DAY && value.time < row.start + 8 * DAY));
    return {
      signups: subset.length, instrumentedSignups: instrumented.length, eligible24h: eligible24.length, successful24h: successful24.length,
      successfulValueRate: eligible24.length ? successful24.length / eligible24.length : null,
      eligible7d: eligible7.length, nonChat7d: nonChat.length, nonChatRate: eligible7.length ? nonChat.length / eligible7.length : null,
      eligibleD7: eligibleD7.length, returnedD7: returned.length, returnD7Rate: eligibleD7.length ? returned.length / eligibleD7.length : null,
      eligible30d: instrumented.filter((row) => row.start + 30 * DAY <= observedThrough).length,
    };
  };
  const mature = rows.filter((row) => row.version !== 'legacy' && row.start + 30 * DAY <= observedThrough);
  const purchases = mature.flatMap((row) => row.activity.filter((event) => PURCHASES.has(event.event)).slice(0, 1));
  const purchaseType = (event: MixpanelEvent) => {
    const trial = event.properties.is_trial ?? event.properties.has_trial;
    const period = text(event.properties.period_type).toLowerCase();
    if (trial === true || trial === 'true' || period === 'trial') return 'trial';
    if (trial === false || trial === 'false' || period === 'normal') return 'nonTrial';
    return 'unknown';
  };
  const times = rows.filter((row) => row.start + DAY <= observedThrough && row.first && row.first.time <= row.start + DAY).map((row) => (row.first!.time - row.start) / 60).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const medianMinutesToValue = times.length ? (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2) : null;
  const group = (key: 'platform' | 'deviceFamily' | 'version') => [...new Set(rows.map((row) => row[key]))].sort().map((name) => ({ name, ...summary(rows.filter((row) => row[key] === name)) }));
  const uniqueActivity = (name: string) => rows.filter((row) => row.activity.some((event) => event.event === name)).length;
  const selected = new Map<string, Set<string>>();
  const pages = new Map<string, Set<string>>();
  const sourceRows = new Map<string, { viewed: Set<string>; dismissed: Set<string>; checkouts: Set<string> }>();
  for (const row of rows) {
    for (const event of row.activity) {
      const isAction = event.event === 'Journey_Tour_Action_Selected';
      const isPage = event.event === 'Journey_Tour_Page_Viewed';
      if (isAction || isPage) {
        const key = text(event.properties[isAction ? 'destination' : 'page']) || 'unknown';
        const target = isAction ? selected : pages;
        if (!target.has(key)) target.set(key, new Set());
        target.get(key)!.add(row.id);
      }
      if (event.event !== 'Paywall_Viewed') continue;
      const source = text(event.properties.source) || 'unknown';
      if (!sourceRows.has(source)) sourceRows.set(source, { viewed: new Set(), dismissed: new Set(), checkouts: new Set() });
      const stats = sourceRows.get(source)!;
      stats.viewed.add(row.id);
      const later = row.activity.filter((next) => next.properties.time >= event.properties.time && text(next.properties.source) === text(event.properties.source));
      if (later.some((next) => ['Paywall_Dismissed', 'Paywall Dismissed'].includes(next.event))) stats.dismissed.add(row.id);
      if (later.some((next) => PURCHASES.has(next.event))) stats.checkouts.add(row.id);
    }
  }
  return {
    ...summary(rows), medianMinutesToValue, dateRange, observedThrough: new Date(observedThrough * 1000).toISOString(),
    byPlatform: group('platform'), byDeviceFamily: group('deviceFamily'), byJourneyVersion: group('version'),
    funnel: buildFunnel([
      { name: 'Accounts created (30d mature)', count: mature.length },
      { name: 'Successful value delivered', count: mature.filter((row) => row.first).length },
      { name: 'Then paywall viewed', count: mature.filter((row) => row.paywall).length },
      { name: 'Then checkout completed', count: mature.filter((row) => row.checkout).length },
    ]),
    tour: { viewed: uniqueActivity('Journey_Tour_Viewed'), dismissed: uniqueActivity('Journey_Tour_Dismissed'),
      actions: [...selected].map(([name, ids]) => ({ name, accounts: ids.size })), pages: [...pages].map(([name, ids]) => ({ name, accounts: ids.size })) },
    paywallSources: [...sourceRows].map(([source, stats]) => ({ source, viewed: stats.viewed.size, dismissed: stats.dismissed.size, checkouts: stats.checkouts.size })),
    clientCheckouts30d: { trials: purchases.filter((event) => purchaseType(event) === 'trial').length,
      nonTrial: purchases.filter((event) => purchaseType(event) === 'nonTrial').length,
      unknown: purchases.filter((event) => purchaseType(event) === 'unknown').length },
    paidConversion30d: null, revenuePerNewAccount30d: null,
    revenueUnavailableReason: 'Account-level authoritative transactions, trial conversions, refunds, and currency normalization are not connected to this cohort dataset. Client checkouts are not paid revenue.',
  };
}
