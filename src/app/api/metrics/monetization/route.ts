// Monetization funnel — Paywall → Plan → Purchase, from Mixpanel events.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { buildFunnel } from '@/lib/funnel';
import { getDateRange, getDaysInRange, formatDate } from '@/lib/utils';
import { MixpanelEvent } from '@/types/mixpanel';

const MONETIZATION_EVENTS = [
  'Paywall_Viewed',
  'Paywall Dismissed',
  'Paywall_Dismissed',
  'Plan_Selected',
  'Purchase_Initiated',
  'Purchase_Completed',
  'Purchase Completed',
  '$ae_iap',
  'Purchase_Failed',
  'Purchase_Cancelled',
  'Feature_Limit_Reached',
];

const PURCHASE_EVENTS = new Set(['Purchase_Completed', 'Purchase Completed', '$ae_iap']);

function uniq(events: MixpanelEvent[], predicate: (e: MixpanelEvent) => boolean): number {
  return new Set(events.filter(predicate).map((e) => e.properties.distinct_id)).size;
}

function platformGroup(e: MixpanelEvent): 'web' | 'iOS' | 'macOS' | 'other' {
  const os = (e.properties.$os as string) || '';
  const mpLib = (e.properties.mp_lib as string) || '';
  const platform = (e.properties.platform as string) || '';
  if (mpLib === 'web' || platform === 'web') return 'web';
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  if (os === 'iOS' || os === 'iPadOS' || os === 'visionOS' || platform === 'iOS' || platform === 'visionOS') return 'iOS';
  return 'other';
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const raw = await fetchMixpanelEventsFiltered(dateRange.from, dateRange.to, MONETIZATION_EVENTS);
    const platformFiltered = filterByPlatform(raw, platform);
    const events = filterByUserType(platformFiltered, userType);

    const isPaywallView = (e: MixpanelEvent) => e.event === 'Paywall_Viewed';
    const isPlanSelected = (e: MixpanelEvent) => e.event === 'Plan_Selected';
    const isPurchaseInit = (e: MixpanelEvent) => e.event === 'Purchase_Initiated';
    const isPurchase = (e: MixpanelEvent) => PURCHASE_EVENTS.has(e.event);
    const isDismiss = (e: MixpanelEvent) => e.event === 'Paywall_Dismissed' || e.event === 'Paywall Dismissed';

    // ---- Main funnel (unique users) ----
    const funnel = buildFunnel([
      { name: 'Paywall Viewed', count: uniq(events, isPaywallView) },
      { name: 'Plan Selected', count: uniq(events, isPlanSelected) },
      { name: 'Purchase Started', count: uniq(events, isPurchaseInit) },
      { name: 'Purchased', count: uniq(events, isPurchase) },
    ]);

    // ---- KPIs ----
    const paywallViews = uniq(events, isPaywallView);
    const purchases = uniq(events, isPurchase);
    // Unique users (matches paywallViews' unit) so the rate stays within 0–100%.
    const dismissals = uniq(events, isDismiss);
    const failures = events.filter((e) => e.event === 'Purchase_Failed').length;
    const cancellations = events.filter((e) => e.event === 'Purchase_Cancelled').length;
    const overallConversion = paywallViews > 0 ? purchases / paywallViews : 0;
    const dismissalRate = paywallViews > 0 ? dismissals / paywallViews : 0;

    // ---- By platform ----
    const platforms: ('web' | 'iOS' | 'macOS')[] = ['web', 'iOS', 'macOS'];
    const byPlatform = platforms.map((p) => {
      const pe = events.filter((e) => platformGroup(e) === p);
      const views = uniq(pe, isPaywallView);
      const buys = uniq(pe, isPurchase);
      return { platform: p, views, purchases: buys, conversion: views > 0 ? buys / views : 0 };
    });

    // ---- Plan mix (from Plan_Selected.plan_type, fallback product_id) ----
    const planCounts = new Map<string, number>();
    for (const e of events.filter(isPlanSelected)) {
      const plan = String(e.properties.plan_type ?? e.properties.product_id ?? 'Unknown');
      planCounts.set(plan, (planCounts.get(plan) || 0) + 1);
    }
    const planMix = Array.from(planCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // ---- Paywall sources ----
    const sourceCounts = new Map<string, number>();
    for (const e of events.filter(isPaywallView)) {
      const src = String(e.properties.source ?? 'Unknown');
      sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
    }
    const paywallSources = Array.from(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // ---- Feature limits that drive upgrades ----
    const limitCounts = new Map<string, number>();
    for (const e of events.filter((ev) => ev.event === 'Feature_Limit_Reached')) {
      const feat = String(e.properties.feature ?? 'Unknown');
      limitCounts.set(feat, (limitCounts.get(feat) || 0) + 1);
    }
    const featureLimits = Array.from(limitCounts)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count);

    // ---- Daily series ----
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const de = events.filter((e) => formatDate(new Date(e.properties.time * 1000)) === date);
      return {
        date,
        paywallViewed: uniq(de, isPaywallView),
        planSelected: uniq(de, isPlanSelected),
        purchaseStarted: uniq(de, isPurchaseInit),
        purchased: uniq(de, isPurchase),
      };
    });

    return NextResponse.json(
      {
        funnel,
        kpis: {
          paywallViews,
          purchases,
          overallConversion,
          dismissalRate,
          failures,
          cancellations,
        },
        byPlatform,
        planMix,
        paywallSources,
        featureLimits,
        dailyData,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching monetization metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch monetization metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
