import { describe, expect, it } from 'vitest';
import {
  countCustomerUsage,
  eventsOnOrAfter,
  filterCustomerEvents,
} from '@/lib/customer-activity';
import type { MixpanelEvent } from '@/types/mixpanel';

function event(
  name: string,
  properties: Partial<MixpanelEvent['properties']> = {},
): MixpanelEvent {
  return {
    event: name,
    properties: {
      time: Date.parse('2026-08-02T12:00:00Z') / 1000,
      distinct_id: 'device-id',
      ...properties,
    },
  };
}

describe('customer activity helpers', () => {
  it('matches Firebase identity aliases and deduplicates insert ids', () => {
    const events = [
      event('Search_Performed', { $user_id: 'uid-1', $insert_id: 'same' }),
      event('Search_Performed', { user_id: 'uid-1', $insert_id: 'same' }),
      event('Note_Created', { distinct_id: 'uid-1' }),
      event('Search_Performed', { user_id: 'someone-else' }),
    ];

    expect(filterCustomerEvents(events, 'uid-1')).toHaveLength(2);
  });

  it('counts canonical customer actions, including legacy event names', () => {
    const usage = countCustomerUsage([
      event('Search'),
      event('Document_Uploaded'),
      event('Image_Generation_Completed'),
      event('Note_Created'),
      event('Collection_Created'),
      event('inbox_capture_created'),
      event('monitor_run_completed'),
      event('Artifact_Completed'),
      event('Note_Viewed'),
    ]);

    expect(usage).toEqual({
      searches: 1,
      documents: 1,
      images: 1,
      notes: 1,
      collections: 1,
      captures: 1,
      automations: 1,
      artifacts: 1,
    });
  });

  it('limits month-to-date usage without dropping the rolling activity window', () => {
    const events = [
      event('Search_Performed', {
        time: Date.parse('2026-07-31T23:59:59Z') / 1000,
      }),
      event('Search_Performed', {
        time: Date.parse('2026-08-01T00:00:00Z') / 1000,
      }),
    ];

    expect(eventsOnOrAfter(events, '2026-08-01')).toHaveLength(1);
  });

});
