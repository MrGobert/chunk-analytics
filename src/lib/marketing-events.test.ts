import { describe, expect, it } from 'vitest';
import {
  marketingJourneyId,
  marketingIdentityLinks,
  marketingFeaturePageVisits,
  marketingPageKey,
  mergeCanonicalAndLegacy,
  orderedJourneyCounts,
} from './marketing-events';
import { MixpanelEvent } from '@/types/mixpanel';

function event(
  name: string,
  time: number,
  properties: Record<string, unknown> = {},
): MixpanelEvent {
  return {
    event: name,
    properties: {
      time,
      distinct_id: String(properties.distinct_id || 'anonymous-id'),
      ...properties,
    },
  };
}

describe('marketing event compatibility', () => {
  it('counts a canonical/legacy dual-write once', () => {
    const events = [
      event('Marketing_Page_Viewed', 100, { $device_id: 'device-1', page_path: '/' }),
      event('Page_Viewed', 101, { $device_id: 'device-1', page_path: '/' }),
    ];

    expect(
      mergeCanonicalAndLegacy(events, 'Marketing_Page_Viewed', ['Page_Viewed'], [
        'page_path',
      ]),
    ).toEqual([events[0]]);
  });

  it('retains an extra event instead of hiding a real duplicate', () => {
    const events = [
      event('Marketing_CTA_Clicked', 100, { $device_id: 'device-1', cta_id: 'home.hero' }),
      event('Create_Account_Clicked', 100, { $device_id: 'device-1', cta_id: 'home.hero' }),
      event('Create_Account_Clicked', 101, { $device_id: 'device-1', cta_id: 'home.hero' }),
    ];

    expect(
      mergeCanonicalAndLegacy(
        events,
        'Marketing_CTA_Clicked',
        ['Create_Account_Clicked'],
        ['cta_id'],
      ),
    ).toHaveLength(2);
  });

  it('uses device identity to connect anonymous and signed-in stages', () => {
    const pageView = event('Marketing_Page_Viewed', 100, {
      distinct_id: 'anonymous-id',
      $device_id: 'device-1',
    });
    const signup = event('Signup_Completed', 120, {
      distinct_id: 'user-1',
      $device_id: 'device-1',
    });

    expect(marketingJourneyId(signup)).toBe('device-1');
    expect(
      orderedJourneyCounts([
        { name: 'Visitors', events: [pageView] },
        { name: 'Completed signups', events: [signup] },
      ]),
    ).toEqual([
      { name: 'Visitors', count: 1 },
      { name: 'Completed signups', count: 1 },
    ]);
  });

  it('links server subscription events back to the browser journey', () => {
    const signup = event('Signup_Completed', 120, {
      distinct_id: 'user-1',
      $user_id: 'user-1',
      $device_id: 'device-1',
    });
    const subscription = event('Purchase_Completed', 180, {
      distinct_id: 'user-1',
    });
    const links = marketingIdentityLinks([signup, subscription]);

    expect(marketingJourneyId(subscription, links)).toBe('device-1');
  });

  it('does not guess a browser journey for an account seen on multiple devices', () => {
    const links = marketingIdentityLinks([
      event('Signup_Completed', 100, {
        distinct_id: 'user-1',
        $device_id: 'device-1',
      }),
      event('Login_Completed', 200, {
        distinct_id: 'user-1',
        $device_id: 'device-2',
      }),
    ]);
    const serverEvent = event('Purchase_Completed', 300, {
      distinct_id: 'user-1',
    });

    expect(marketingJourneyId(serverEvent, links)).toBe('user-1');
  });

  it('maps legacy page labels to canonical attribution keys', () => {
    expect(marketingPageKey(event('Page_Viewed', 100, { page_name: 'Landing Page' }))).toBe(
      'home',
    );
    expect(
      marketingPageKey(event('Page_Viewed', 100, { page_name: 'Monitors Feature Page' })),
    ).toBe('feature_automations');
  });

  it('deduplicates canonical feature page views from legacy feature events', () => {
    const events = [
      event('Marketing_Page_Viewed', 100, {
        $device_id: 'device-1',
        page_id: 'feature_research',
        page_path: '/features/research',
      }),
      event('Feature_Page_Visited', 101, {
        $device_id: 'device-1',
        page: 'research',
        page_path: '/features/research',
      }),
    ];

    expect(marketingFeaturePageVisits(events)).toEqual([events[0]]);
  });
});
