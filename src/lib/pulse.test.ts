import { describe, expect, it } from 'vitest';
import { aggregatePulseMetrics, PULSE_EVENT_NAMES } from '@/lib/pulse';
import type { MixpanelEvent } from '@/types/mixpanel';

function event(
  name: string,
  uid: string,
  date: string,
  properties: Record<string, unknown> = {},
): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: new Date(`${date}T20:00:00Z`).getTime() / 1000,
      distinct_id: uid,
      platform: 'web',
      ...properties,
    },
  };
}

describe('Pulse event export', () => {
  it('requests Apple/web sessions and legacy business aliases', () => {
    expect(PULSE_EVENT_NAMES).toEqual(expect.arrayContaining([
      'App_Session_Started',
      '$ae_session',
      'Session_Started',
      'Signup_Completed',
      'Account Created',
      'Search_Performed',
      'Search Performed',
      'Purchase_Completed',
      '$ae_iap',
    ]));
  });
});

describe('aggregatePulseMetrics', () => {
  const today = '2026-07-19';
  const currentDays = ['2026-07-18', today];
  const priorDays = ['2026-07-16', '2026-07-17'];

  it('populates DAU, snapshot, funnel, creators, and new top movers', () => {
    const metrics = aggregatePulseMetrics([
      event('App_Session_Started', 'u1', today),
      event('$ae_session', 'u2', today),
      event('App_Session_Started', 'last-week-user', '2026-07-12'),
      event('Account Created', 'signup-1', today),
      event('Paywall_Viewed', 'buyer-1', today),
      event('Paywall_Viewed', 'buyer-1', today), // unique-user snapshot/funnel
      event('Plan_Selected', 'buyer-1', today),
      event('Purchase_Initiated', 'trial-failed', today, { is_trial: true }),
      event('Purchase_Completed', 'buyer-1', today, { is_trial: true }),
      event('Search Performed', 'u1', today),
      event('Note_Created', 'u2', today),
      event('Note_Created', 'u2', '2026-07-18'),
      event('Search_Performed', 'prior-creator', '2026-07-17'),
    ], { currentDays, priorDays, today });

    expect(metrics.todayDAU).toBe(2);
    expect(metrics.sameWeekdayDAU).toBe(1);
    expect(metrics.dauTrend).toEqual([
      { date: '2026-07-18', users: 1 },
      { date: today, users: 2 },
    ]);
    expect(metrics.scopeSignups).toBe(1);
    expect(metrics.scopeTrialStarts).toBe(1);
    expect(metrics.scopePurchases).toBe(1);
    expect(metrics.scopePaywallViews).toBe(1);
    expect(metrics.microFunnel).toEqual({
      paywallViewed: 1,
      planSelected: 1,
      purchaseInitiated: 1,
      purchaseCompleted: 1,
    });
    expect(metrics.activeCreators).toBe(2);
    expect(metrics.activeCreatorsPrev).toBe(1);
    expect(metrics.topMovers.gainers).toContainEqual({
      category: 'Notes',
      current: 2,
      previous: 0,
      change: null,
    });
  });

  it('does not count an initiated or failed checkout as a started trial', () => {
    const metrics = aggregatePulseMetrics([
      event('Purchase_Initiated', 'u1', today, { is_trial: true }),
      event('Purchase_Failed', 'u1', today),
    ], { currentDays, priorDays, today });

    expect(metrics.todayTrialStarts).toBe(0);
    expect(metrics.scopeTrialStarts).toBe(0);
    expect(metrics.todayPurchaseFailures).toBe(1);
  });

  it('keeps events outside the selected range out of range-scoped cards', () => {
    const metrics = aggregatePulseMetrics([
      event('Signup_Completed', 'current', today),
      event('Signup_Completed', 'prior', '2026-07-17'),
    ], { currentDays, priorDays, today });

    expect(metrics.scopeSignups).toBe(1);
    expect(metrics.todaySignups).toBe(1);
  });
});
