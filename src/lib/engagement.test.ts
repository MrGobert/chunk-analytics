import { describe, expect, it } from 'vitest';
import {
  aggregateAdvancedEngagement,
  aggregatePowerUsers,
  aggregateUserEngagement,
  ENGAGEMENT_EXPORT_EVENT_NAMES,
  engagementWeekStart,
  isEngagementActivityEvent,
} from '@/lib/engagement';
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

describe('engagement analytics', () => {
  it('requests the narrow activity, session aliases, and classification context', () => {
    expect(ENGAGEMENT_EXPORT_EVENT_NAMES).toEqual(
      expect.arrayContaining([
        'App_Session_Started',
        '$ae_session',
        'Session_Started',
        'Search_Performed',
        'Search Performed',
        'Project_Created',
        'Purchase_Completed',
        'Purchase Completed',
        'Subscription_Started',
        '$ae_first_open',
      ]),
    );
  });

  it('defines activity as app sessions or genuine product feature use', () => {
    expect(isEngagementActivityEvent(event('$ae_session', 'session', '2026-07-05'))).toBe(true);
    expect(isEngagementActivityEvent(event('Search_Performed', 'search', '2026-07-05'))).toBe(true);
    expect(isEngagementActivityEvent(event('Project_Opened', 'projects', '2026-07-05'))).toBe(true);
    expect(isEngagementActivityEvent(event('Project_Start_Clicked', 'projects-intent', '2026-07-05'))).toBe(false);
    expect(
      isEngagementActivityEvent(
        event('Connector_Operation_Used', 'failed', '2026-07-05', {
          status: 'failed',
        }),
      ),
    ).toBe(false);
    expect(isEngagementActivityEvent(event('Purchase_Completed', 'buyer', '2026-07-05'))).toBe(false);
    expect(
      isEngagementActivityEvent(
        event('Marketing_Session_Started', 'visitor', '2026-07-05'),
      ),
    ).toBe(false);
  });

  it('builds DAU, WAU, MAU, and sessions from activity in UTC', () => {
    const metrics = aggregateUserEngagement(
      [
        event('$ae_session', 'u1', '2026-07-05', {
          $ae_session_length: 45,
          mp_country_code: 'US',
        }),
        event('Search_Performed', 'u1', '2026-07-05'),
        event('Purchase_Completed', 'billing-only', '2026-07-06'),
        event('Marketing_Session_Started', 'marketing-only', '2026-07-06'),
        event('Connector_Operation_Used', 'failed-op', '2026-07-06', {
          status: 'failed',
        }),
        event('Connector_Operation_Used', 'u2', '2026-07-06', {
          status: 'completed',
        }),
      ],
      { from: '2026-07-05', to: '2026-07-06' },
    );

    expect(metrics.dau).toEqual([
      { date: '2026-07-05', users: 1 },
      { date: '2026-07-06', users: 1 },
    ]);
    expect(metrics.wau).toEqual([{ week: '2026-07-05', users: 2 }]);
    expect(metrics.mau).toEqual([{ month: '2026-07', users: 2 }]);
    expect(metrics.sessionDurations.find((row) => row.range === '30s-1m')).toEqual({
      range: '30s-1m',
      count: 1,
    });
    expect(metrics.sessionsPerUser[0]).toEqual({ sessions: '1', users: 1 });
    expect(engagementWeekStart('2026-08-01')).toBe('2026-07-26');
  });

  it('uses active product users for advanced denominators and retention', () => {
    const metrics = aggregateAdvancedEngagement(
      [
        event('$ae_first_open', 'active-subscriber', '2026-07-05'),
        event('$ae_session', 'active-subscriber', '2026-07-06', {
          $ae_session_length: 120,
          $user_id: 'active-subscriber',
        }),
        event('Search Performed', 'active-subscriber', '2026-07-06'),
        event('Image_Generation_Completed', 'active-subscriber', '2026-07-06'),
        event('Purchase Completed', 'active-subscriber', '2026-07-06'),
        event('Purchase Completed', 'billing-only', '2026-07-06'),
        event('Marketing_Session_Started', 'marketing-only', '2026-07-06'),
      ],
      { from: '2026-07-05', to: '2026-07-06' },
    );

    expect(metrics.mau).toBe(1);
    expect(metrics.avgDAU).toBe(1);
    expect(metrics.avgSessionDuration).toBe(120);
    expect(metrics.searchesPerUser).toBe(1);
    expect(metrics.retention).toMatchObject({ day1: 100, totalNewUsers: 1 });
    expect(metrics.userBreakdown).toMatchObject({
      total: 1,
      paid: 1,
      free: 0,
      guest: 0,
      authenticated: 1,
    });
    expect(
      metrics.featureAdoption.find((row) => row.feature === 'Image Generation'),
    ).toMatchObject({ users: 1, adoptionRate: 100 });
  });

  it('segments Power Users from genuine activity rather than billing or marketing noise', () => {
    const events = [
      event('App_Session_Started', 'power-user', '2026-07-01', {
        $user_id: 'power-user',
      }),
      event('Search_Performed', 'power-user', '2026-07-02'),
      event('Note_Created', 'power-user', '2026-07-03'),
      event('Image_Generation_Completed', 'power-user', '2026-07-04'),
      event('App_Session_Started', 'power-user', '2026-07-05'),
      event('Purchase_Completed', 'power-user', '2026-07-05'),
      event('Purchase_Completed', 'billing-only', '2026-07-05'),
      event('Marketing_Session_Started', 'marketing-only', '2026-07-05'),
      event('Search_Performed', 'guest-user', '2026-07-05'),
      event('Search_Performed', 'casual-user', '2026-07-05'),
      event('Connector_Operation_Used', 'casual-user', '2026-07-05', {
        status: 'failed',
      }),
    ];
    const metrics = aggregatePowerUsers(events, {
      from: '2026-07-01',
      to: '2026-07-07',
    });

    expect(metrics.totalUsers).toBe(2);
    expect(metrics.segments.find((segment) => segment.segment === 'Power')).toMatchObject({
      count: 1,
      subscribers: 1,
    });
    expect(metrics.segments.find((segment) => segment.segment === 'Casual')).toMatchObject({
      count: 1,
    });
    expect(metrics.topUsers[0]).toMatchObject({
      uid: 'power-user',
      activeDays: 5,
      features: 3,
      events: 5,
      subscriber: true,
    });
    expect(metrics.topUsers.find((user) => user.uid === 'casual-user')).toMatchObject({
      events: 1,
      features: 1,
    });
  });
});
