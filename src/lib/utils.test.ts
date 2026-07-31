import { describe, expect, it } from 'vitest';
import { formatDate, getDaysInRange, MIXPANEL_PROJECT_TIME_ZONE } from './utils';

describe('Mixpanel project date handling', () => {
  it('uses the Mixpanel project timezone for late Pacific-evening events', () => {
    expect(MIXPANEL_PROJECT_TIME_ZONE).toBe('UTC');
    expect(formatDate(new Date('2026-07-31T04:49:00Z'))).toBe('2026-07-31');
  });

  it('produces stable inclusive UTC date ranges', () => {
    expect(getDaysInRange('2026-07-30', '2026-08-01')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });
});
