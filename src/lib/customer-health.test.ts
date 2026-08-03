import { describe, expect, it } from 'vitest';
import {
  emailEngagementScore,
  recoverTenureFactor,
} from '@/lib/customer-health';

describe('customer health helpers', () => {
  it('scores actual email opens and clicks instead of sent markers', () => {
    expect(emailEngagementScore([
      { sentAt: '2026-08-01T00:00:00Z', delivered: true, opened: true },
      { sentAt: '2026-08-02T00:00:00Z', delivered: true },
      { sentAt: '2026-08-03T00:00:00Z', clicked: true },
      { sentAt: '2026-08-04T00:00:00Z', delivered: true },
    ])).toBe(50);
    expect(emailEngagementScore([])).toBeNull();
  });

  it('undoes the backend tenure gate only when Mixpanel repairs recency', () => {
    expect(recoverTenureFactor(25, 0, 90)).toBe(50);
    expect(recoverTenureFactor(25, 0, 0)).toBe(25);
    expect(recoverTenureFactor(80, 0, 90)).toBe(100);
    expect(recoverTenureFactor(40, 10, 90)).toBe(40);
  });
});
