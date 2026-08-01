import { describe, expect, it } from 'vitest';
import {
  aggregateFeatureActivity,
  dedupeMixpanelEvents,
  FEATURE_ACTIVITY_EXPORT_EVENT_NAMES,
} from '@/lib/feature-activity';
import { aggregatePulseMetrics } from '@/lib/pulse';
import { filterByPlatform, filterByUserType } from '@/lib/mixpanel';
import type { MixpanelEvent } from '@/types/mixpanel';

const currentDay = '2026-07-19';
const priorDay = '2026-07-18';

function event(
  name: string,
  uid: string,
  date = currentDay,
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

function byName(
  activity: ReturnType<typeof aggregateFeatureActivity>,
  name: string,
) {
  return activity.features.find((feature) => feature.name === name)!;
}

describe('canonical feature activity registry', () => {
  it('requests the context, aliases, and primary feature events used by both endpoints', () => {
    expect(FEATURE_ACTIVITY_EXPORT_EVENT_NAMES).toEqual(expect.arrayContaining([
      'App_Session_Started',
      '$ae_session',
      'Signup_Completed',
      'Account Created',
      'Login_Completed',
      'Subscription_Started',
      'Search_Performed',
      'Search Performed',
      'Image_Generation_Completed',
      'inbox_capture_created',
      'Onboarding_Completed',
    ]));
  });

  it('uses comparable primary actions while retaining genuine lifecycle activity', () => {
    const activity = aggregateFeatureActivity([
      event('Search_Performed', 'search'),
      event('Research_Report_Initiated', 'research'),
      event('Research_Report_Completed', 'research'),
      event('Note_Created', 'notes'),
      event('Note_Saved', 'notes'),
      event('Collection_Created', 'collections'),
      event('Collection_Chat_Message_Sent', 'collections'),
      event('Artifact_Failed', 'artifact-error'),
      event('Artifact_Completed', 'artifacts'),
      event('Document_Uploaded', 'documents'),
      event('Image_Generation_Started', 'image'),
      event('Image_Generation_Completed', 'image'),
      event('Image_Generation_Failed', 'image-error'),
      event('Memory_Toggled', 'memory-off', currentDay, { enabled: false }),
      event('Memory_Toggled', 'memory-on', currentDay, { enabled: true }),
      event('Connector_Connect_Failed', 'connector-error'),
      event('Notion_Page_Created', 'connector-specific'),
      event('Connector_Operation_Used', 'connector-failed-op', currentDay, { status: 'failed' }),
      event('Connector_Operation_Used', 'connector-op', currentDay, { status: 'completed' }),
      event('Connector_Connect_Succeeded', 'connector-connect'),
      event('Connections_Action_Used', 'connections'),
      event('Automation_Edited', 'automation'),
      event('Automation_Created', 'automation'),
      event('Automation_Run_Now', 'automation'),
      event('inbox_capture_created', 'capture'),
      event('inbox_item_accepted', 'capture'),
      event('inbox_item_discarded', 'capture'),
    ], { currentDays: [currentDay], priorDays: [priorDay] });

    expect(byName(activity, 'Search')).toMatchObject({ totalEvents: 1, primaryActions: 1 });
    expect(byName(activity, 'Research')).toMatchObject({ totalEvents: 2, primaryActions: 1 });
    expect(byName(activity, 'Notes')).toMatchObject({ totalEvents: 2, primaryActions: 1 });
    expect(byName(activity, 'Collections')).toMatchObject({ totalEvents: 2, primaryActions: 1 });
    expect(byName(activity, 'Artifacts')).toMatchObject({ totalEvents: 1, primaryActions: 1 });
    expect(byName(activity, 'Documents')).toMatchObject({ totalEvents: 1, primaryActions: 1 });
    expect(byName(activity, 'Image Gen')).toMatchObject({ totalEvents: 2, primaryActions: 1 });
    expect(byName(activity, 'Memory')).toMatchObject({ totalEvents: 2, primaryActions: 1 });
    expect(byName(activity, 'Connectors')).toMatchObject({ totalEvents: 2, primaryActions: 2 });
    expect(byName(activity, 'Connections')).toMatchObject({ totalEvents: 1, primaryActions: 1 });
    expect(byName(activity, 'Automations')).toMatchObject({ totalEvents: 3, primaryActions: 2 });
    expect(byName(activity, 'Capture')).toMatchObject({ totalEvents: 3, primaryActions: 1 });
  });

  it('deduplicates insert ids without collapsing legitimate repeated events', () => {
    const duplicated = event('Note_Created', 'u1', currentDay, { $insert_id: 'same' });
    const uniqueWithoutInsertId = event('Note_Created', 'u1');
    const events = [duplicated, { ...duplicated, properties: { ...duplicated.properties } }, uniqueWithoutInsertId];

    expect(dedupeMixpanelEvents(events)).toHaveLength(2);
    const activity = aggregateFeatureActivity(events, {
      currentDays: [currentDay],
      priorDays: [priorDay],
    });
    expect(byName(activity, 'Notes').primaryActions).toBe(2);
    expect(activity.deduplicatedCount).toBe(1);
  });

  it('ranks material absolute movement ahead of tiny new categories', () => {
    const events = [
      ...Array.from({ length: 10 }, (_, i) => event('Note_Created', `current-note-${i}`)),
      ...Array.from({ length: 6 }, (_, i) => event('Note_Created', `prior-note-${i}`, priorDay)),
      event('Image_Generation_Completed', 'new-image'),
    ];
    const activity = aggregateFeatureActivity(events, {
      currentDays: [currentDay],
      priorDays: [priorDay],
    });

    expect(activity.topMovers.gainers[0]).toMatchObject({
      category: 'Notes',
      current: 10,
      previous: 6,
      delta: 4,
    });
    expect(activity.topMovers.gainers[1]).toMatchObject({
      category: 'Image Gen',
      current: 1,
      previous: 0,
      delta: 1,
    });
  });

  it('keeps Pulse and Features on the exact same mover result', () => {
    const events = [
      event('inbox_capture_created', 'capture-current'),
      event('inbox_item_accepted', 'capture-current'),
      event('inbox_capture_created', 'capture-prior', priorDay),
      event('Image_Generation_Completed', 'image-current'),
    ];
    const activity = aggregateFeatureActivity(events, {
      currentDays: [currentDay],
      priorDays: [priorDay],
    });
    const pulse = aggregatePulseMetrics(events, {
      currentDays: [currentDay],
      priorDays: [priorDay],
      today: currentDay,
      featureActivity: activity,
    });

    expect(pulse.topMovers).toEqual(activity.topMovers);
    expect(byName(activity, 'Capture')).toMatchObject({
      totalEvents: 2,
      primaryActions: 1,
      previousPrimaryActions: 1,
    });
  });

  it('applies one platform and user classification scope across both periods', () => {
    const subscriberPurchase = event('Purchase Completed', 'subscriber');
    const subscriberPriorNote = event('Note_Created', 'subscriber', priorDay);
    const webVisitorNote = event('Note_Created', 'web-visitor');
    const iosSubscriberNote = event('Note_Created', 'ios-subscriber', currentDay, {
      $os: 'iOS',
      platform: 'iOS',
      is_pro: true,
    });
    const combined = [
      subscriberPurchase,
      subscriberPriorNote,
      webVisitorNote,
      iosSubscriberNote,
    ];
    const scoped = filterByUserType(filterByPlatform(combined, 'web'), 'subscribers');
    const activity = aggregateFeatureActivity(scoped, {
      currentDays: [currentDay],
      priorDays: [priorDay],
    });

    expect(byName(activity, 'Notes')).toMatchObject({
      primaryActions: 0,
      previousPrimaryActions: 1,
    });
  });
});
