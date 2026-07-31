import { describe, expect, it } from 'vitest';
import { referrerHost } from './mixpanel';

describe('referrerHost', () => {
  it('accepts the sanitized host emitted by chunk-web', () => {
    expect(referrerHost('www.google.com')).toBe('google.com');
  });

  it('accepts historical full URLs without exposing their path', () => {
    expect(referrerHost('https://news.example.com/private/path?token=secret')).toBe(
      'news.example.com',
    );
  });

  it('folds Chunk navigation and empty values into direct traffic', () => {
    expect(referrerHost('app.chunkapp.com')).toBe('(direct)');
    expect(referrerHost('')).toBe('(direct)');
  });
});
