import { describe, expect, it } from 'vitest';
import { customerDetailHref } from '@/lib/customer-links';

describe('customer detail links', () => {
  it('carries reserved UID characters in a query parameter without path routing', () => {
    const uid = 'acct/tenant?region#1 ..';
    const href = customerDetailHref(uid);
    const url = new URL(href, 'https://analytics.example.test');

    expect(url.pathname).toBe('/customers/detail');
    expect(url.searchParams.get('uid')).toBe(uid);
  });
});
