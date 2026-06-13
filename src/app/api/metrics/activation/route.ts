// Activation — signup → first key action within 24h.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  getLastUpdated,
  normalizeEventName,
} from '@/lib/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { buildFunnel } from '@/lib/funnel';
import { KEY_ACTION_EVENTS } from '@/lib/feature-categories';
import { MixpanelEvent } from '@/types/mixpanel';

const SIGNUP = ['Signup_Completed', 'SignUp', 'Account Created'];
// What counts as activation — single source of truth (canonical names), shared
// with Pulse's "active creator" so the two pages agree on the same KPI.
const KEY_ACTIONS = new Set<string>(KEY_ACTION_EVENTS);
// Raw event names (incl. legacy aliases) the filtered export must request so all
// key actions are actually pulled from Mixpanel.
const KEY_ACTION_FETCH = ['Search_Performed', 'Search Performed', 'Search', 'Note_Created', 'Artifact_Created', 'Research_Report_Initiated', 'Collection_Created'];
const SESSION = ['App_Session_Started', '$ae_session'];

const ACTIVATION_EVENTS = [
  ...SIGNUP,
  ...KEY_ACTION_FETCH,
  ...SESSION,
  'First_Run_Onboarding_Completed',
  'First_Run_Onboarding_Skipped',
];

const DAY = 86400;

// Canonical label for the first action a user took.
const ACTION_LABEL: Record<string, string> = {
  Search_Performed: 'Search',
  Note_Created: 'Note',
  Artifact_Created: 'Artifact',
  Research_Report_Initiated: 'Research',
  Collection_Created: 'Collection',
};

function platformOf(e: MixpanelEvent): string {
  const os = (e.properties.$os as string) || '';
  const mpLib = (e.properties.mp_lib as string) || '';
  const platform = (e.properties.platform as string) || '';
  if (mpLib === 'web' || platform === 'web') return 'Web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iPadOS') return 'iPadOS';
  if (os === 'iOS' || platform === 'iOS') return 'iOS';
  if (os === 'visionOS' || platform === 'visionOS') return 'visionOS';
  return 'Other';
}

function startOfWeek(dateStr: string): string {
  // dateStr is YYYY-MM-DD (LA). Bucket to the Monday of that week.
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? 6 : day - 1);
  d.setUTCDate(d.getUTCDate() - diff);
  return formatDate(d);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const raw = await fetchMixpanelEventsFiltered(dateRange.from, dateRange.to, ACTIVATION_EVENTS);
    const events = filterByPlatform(raw, platform);

    // Right-censor: only count signups with ≥24h of observable window. Observation
    // extends to "now" (the latest we can see), so a signup is eligible once it is
    // at least 24h old — correct for both rolling and past custom ranges.
    const cutoff = Date.now() / 1000 - DAY;

    // Earliest signup per user + signup metadata.
    const signups = new Map<string, { time: number; platform: string; method: string }>();
    for (const e of events) {
      if (!SIGNUP.includes(normalizeEventName(e.event)) && !SIGNUP.includes(e.event)) continue;
      const uid = e.properties.distinct_id;
      const t = e.properties.time as number;
      const existing = signups.get(uid);
      if (!existing || t < existing.time) {
        signups.set(uid, {
          time: t,
          platform: platformOf(e),
          method: String(e.properties.method ?? e.properties.signup_method ?? 'unknown'),
        });
      }
    }

    // Per-user sorted key-action times and session times.
    const keyActions = new Map<string, { time: number; type: string }[]>();
    const sessions = new Map<string, number[]>();
    const onboarding = new Map<string, 'completed' | 'skipped'>();

    for (const e of events) {
      const uid = e.properties.distinct_id;
      const canonical = normalizeEventName(e.event);
      const t = e.properties.time as number;
      if (KEY_ACTIONS.has(canonical) || KEY_ACTION_FETCH.includes(e.event)) {
        const type = ACTION_LABEL[canonical] || ACTION_LABEL[e.event] || 'Search';
        if (!keyActions.has(uid)) keyActions.set(uid, []);
        keyActions.get(uid)!.push({ time: t, type });
      }
      if (SESSION.includes(e.event) || SESSION.includes(canonical)) {
        if (!sessions.has(uid)) sessions.set(uid, []);
        sessions.get(uid)!.push(t);
      }
      if (e.event === 'First_Run_Onboarding_Completed') onboarding.set(uid, 'completed');
      else if (e.event === 'First_Run_Onboarding_Skipped' && !onboarding.has(uid)) onboarding.set(uid, 'skipped');
    }
    for (const arr of keyActions.values()) arr.sort((a, b) => a.time - b.time);

    // ---- Per-eligible-signup activation analysis ----
    interface Row { activated: boolean; firstType: string | null; minutesToFirst: number | null; secondWithin24h: boolean; returnedD1: boolean; platform: string; method: string; week: string; onboarding?: 'completed' | 'skipped' }
    const rows: Row[] = [];

    for (const [uid, s] of signups) {
      if (s.time > cutoff) continue; // right-censored
      const actions = (keyActions.get(uid) || []).filter((a) => a.time >= s.time && a.time <= s.time + DAY);
      const first = actions[0];
      const second = actions[1];
      const sess = sessions.get(uid) || [];
      const returnedD1 = sess.some((t) => t >= s.time + DAY && t <= s.time + 2 * DAY);
      rows.push({
        activated: Boolean(first),
        firstType: first?.type ?? null,
        minutesToFirst: first ? Math.round((first.time - s.time) / 60) : null,
        secondWithin24h: Boolean(second),
        returnedD1,
        platform: s.platform,
        method: s.method,
        week: startOfWeek(formatDate(new Date(s.time * 1000))),
        onboarding: onboarding.get(uid),
      });
    }

    const eligible = rows.length;
    const activatedRows = rows.filter((r) => r.activated);
    const activationRate = eligible > 0 ? activatedRows.length / eligible : 0;

    // Funnel
    const funnel = buildFunnel([
      { name: 'Signed Up', count: eligible },
      { name: 'First action ≤24h', count: activatedRows.length },
      { name: '2nd action ≤24h', count: rows.filter((r) => r.secondWithin24h).length },
      { name: 'Returned next day', count: rows.filter((r) => r.returnedD1).length },
    ]);

    // First-action mix
    const mix = new Map<string, number>();
    for (const r of activatedRows) if (r.firstType) mix.set(r.firstType, (mix.get(r.firstType) || 0) + 1);
    const firstActionMix = Array.from(mix).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    // Time-to-first-action histogram
    const buckets = [
      { label: '< 5 min', test: (m: number) => m < 5 },
      { label: '< 1 hour', test: (m: number) => m >= 5 && m < 60 },
      { label: '< 6 hours', test: (m: number) => m >= 60 && m < 360 },
      { label: '< 24 hours', test: (m: number) => m >= 360 && m <= 1440 },
    ];
    const timeToFirstAction = buckets.map((b) => ({
      bucket: b.label,
      count: activatedRows.filter((r) => r.minutesToFirst != null && b.test(r.minutesToFirst)).length,
    }));
    timeToFirstAction.push({ bucket: 'Never', count: eligible - activatedRows.length });

    const medianMinutes = (() => {
      const times = activatedRows.map((r) => r.minutesToFirst!).filter((m) => m != null).sort((a, b) => a - b);
      if (times.length === 0) return null;
      const mid = Math.floor(times.length / 2);
      // Average the two middle values for even-length arrays (true median).
      return times.length % 2 === 0 ? Math.round((times[mid - 1] + times[mid]) / 2) : times[mid];
    })();

    // By platform / method
    const groupRate = (key: 'platform' | 'method') => {
      const g = new Map<string, { signups: number; activated: number }>();
      for (const r of rows) {
        const k = r[key];
        if (!g.has(k)) g.set(k, { signups: 0, activated: 0 });
        const o = g.get(k)!;
        o.signups++;
        if (r.activated) o.activated++;
      }
      return Array.from(g).map(([name, o]) => ({ name, signups: o.signups, activated: o.activated, rate: o.signups > 0 ? (o.activated / o.signups) * 100 : 0 })).sort((a, b) => b.signups - a.signups);
    };

    // Onboarding completed vs skipped
    const onbGroup = (which: 'completed' | 'skipped') => {
      const subset = rows.filter((r) => r.onboarding === which);
      return { signups: subset.length, rate: subset.length > 0 ? (subset.filter((r) => r.activated).length / subset.length) * 100 : 0 };
    };

    // Weekly activation trend
    const weeks = new Map<string, { signups: number; activated: number }>();
    for (const r of rows) {
      if (!weeks.has(r.week)) weeks.set(r.week, { signups: 0, activated: 0 });
      const o = weeks.get(r.week)!;
      o.signups++;
      if (r.activated) o.activated++;
    }
    const weeklyTrend = Array.from(weeks).map(([week, o]) => ({ week, signups: o.signups, rate: o.signups > 0 ? (o.activated / o.signups) * 100 : 0 })).sort((a, b) => a.week.localeCompare(b.week));

    return NextResponse.json(
      {
        activationRate,
        eligibleSignups: eligible,
        activatedCount: activatedRows.length,
        medianMinutesToFirstAction: medianMinutes,
        funnel,
        firstActionMix,
        timeToFirstAction,
        byPlatform: groupRate('platform'),
        bySignupMethod: groupRate('method'),
        onboarding: { completed: onbGroup('completed'), skipped: onbGroup('skipped') },
        weeklyTrend,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching activation metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activation metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
