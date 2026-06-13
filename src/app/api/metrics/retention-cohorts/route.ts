// Retention cohorts — weekly signup cohorts × Wk0..N retention.
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  getLastUpdated,
  normalizeEventName,
} from '@/lib/mixpanel';
import { formatDate } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';

const SIGNUP = ['Signup_Completed', 'SignUp', 'Account Created'];
const RETURN = ['App_Session_Started', '$ae_session', 'Login_Completed'];
const COHORT_EVENTS = [...SIGNUP, ...RETURN];

const DAY = 86400_000;

/** Noon-UTC anchor of an LA calendar date string — stable for day arithmetic. */
function laNoon(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getTime();
}

/** Monday of the LA week containing the given epoch-seconds. */
function weekStart(timeSec: number): string {
  const laDate = formatDate(new Date(timeSec * 1000)); // YYYY-MM-DD in LA
  const anchor = new Date(laNoon(laDate));
  const day = anchor.getUTCDay(); // weekday of the noon-anchored date
  const diff = day === 0 ? 6 : day - 1;
  return formatDate(new Date(anchor.getTime() - diff * DAY));
}

/** Whole weeks between the cohort's Monday and the event's LA date. */
function weekIndex(signupWeek: string, eventTimeSec: number): number {
  const eventDate = formatDate(new Date(eventTimeSec * 1000));
  return Math.floor((laNoon(eventDate) - laNoon(signupWeek)) / (7 * DAY));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const weeks = Math.min(12, Math.max(4, parseInt(searchParams.get('weeks') || '8', 10)));
    const platform = searchParams.get('platform') || 'all';

    // Window: weeks+1 weeks back from today (cover Wk0..weeks).
    const today = new Date();
    const fromDate = formatDate(new Date(today.getTime() - (weeks + 1) * 7 * DAY));
    const toDate = formatDate(today);

    const raw = await fetchMixpanelEventsFiltered(fromDate, toDate, COHORT_EVENTS);
    const events = filterByPlatform(raw, platform);

    // Earliest signup per user.
    const signupTime = new Map<string, number>();
    for (const e of events) {
      const canonical = normalizeEventName(e.event);
      if (!SIGNUP.includes(e.event) && !SIGNUP.includes(canonical)) continue;
      const uid = e.properties.distinct_id;
      const t = e.properties.time as number;
      const cur = signupTime.get(uid);
      if (cur === undefined || t < cur) signupTime.set(uid, t);
    }

    // Per-cohort: set of users + per-user set of return-week indices.
    interface Cohort { week: string; users: Set<string>; retained: Map<number, Set<string>> }
    const cohorts = new Map<string, Cohort>();
    for (const [uid, t] of signupTime) {
      const wk = weekStart(t);
      if (!cohorts.has(wk)) cohorts.set(wk, { week: wk, users: new Set(), retained: new Map() });
      cohorts.get(wk)!.users.add(uid);
    }

    const isReturn = (e: MixpanelEvent) => {
      const c = normalizeEventName(e.event);
      return RETURN.includes(e.event) || RETURN.includes(c);
    };
    for (const e of events) {
      if (!isReturn(e)) continue;
      const uid = e.properties.distinct_id;
      const st = signupTime.get(uid);
      if (st === undefined) continue;
      const wk = weekStart(st);
      const cohort = cohorts.get(wk);
      if (!cohort) continue;
      const idx = weekIndex(wk, e.properties.time as number);
      if (idx < 0 || idx > weeks) continue;
      if (!cohort.retained.has(idx)) cohort.retained.set(idx, new Set());
      cohort.retained.get(idx)!.add(uid);
    }

    // Build matrix (oldest → newest), Wk0 always 100% by definition.
    const sorted = Array.from(cohorts.values()).sort((a, b) => a.week.localeCompare(b.week));
    const matrix = sorted.map((c) => {
      const size = c.users.size;
      const retention: (number | null)[] = [];
      for (let w = 0; w <= weeks; w++) {
        // Wk0 is the signup week itself — always observed, so never censor it
        // (otherwise the current in-progress cohort renders as a blank row).
        if (w === 0) { retention.push(size > 0 ? 100 : 0); continue; }
        // Censor cells whose week hasn't fully elapsed yet.
        const cohortStart = laNoon(c.week);
        const cellEnd = cohortStart + (w + 1) * 7 * DAY;
        if (cellEnd > today.getTime() + DAY) { retention.push(null); continue; }
        const ret = c.retained.get(w)?.size ?? 0;
        retention.push(size > 0 ? Math.round((ret / size) * 1000) / 10 : 0);
      }
      return { week: c.week, size, retention };
    }).filter((c) => c.size > 0);

    // Average retention curve (size-weighted) across non-null cells per week index.
    const curve: { week: number; retention: number }[] = [];
    for (let w = 0; w <= weeks; w++) {
      let num = 0;
      let den = 0;
      for (const c of matrix) {
        const v = c.retention[w];
        if (v == null) continue;
        num += v * c.size;
        den += c.size;
      }
      if (den > 0) curve.push({ week: w, retention: Math.round((num / den) * 10) / 10 });
    }

    return NextResponse.json(
      {
        weeks,
        cohorts: matrix,
        curve,
        totalSignups: Array.from(signupTime.keys()).length,
        dateRange: { from: fromDate, to: toDate },
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching retention cohorts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch retention cohorts', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
