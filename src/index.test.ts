import { describe, expect, test } from 'vitest';
import { normalizeUrl, computeMeta } from './index';

describe('normalizeUrl', () => {
  test('accepts https urls', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  test('accepts urls without protocol', () => {
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });

  test('rejects invalid urls', () => {
    expect(normalizeUrl('http://')).toBe(null);
    expect(normalizeUrl('')).toBe(null);
    expect(normalizeUrl('javascript:alert(1)')).toBe(null);
  });
});

describe('computeMeta', () => {
  test('returns active for no ttl', () => {
    expect(computeMeta({ url: 'https://example.com', created: 0, valid: true, interstitial_enabled: false })).toEqual({
      expiresAt: null,
      status: 'active',
      remaining: null,
    });
  });

  test('returns expired for past ttl', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(computeMeta({ url: 'https://example.com', created: now - 3600, ttl: 1800, valid: true, interstitial_enabled: false })).toMatchObject({
      status: 'expired',
      remaining: 0,
    });
  });
});
