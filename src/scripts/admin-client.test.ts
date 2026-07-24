import { describe, expect, test } from 'vitest';
import { ADMIN_CLIENT_JS } from './admin-client';

describe('admin client script', () => {
  test('contains the human API routes', () => {
    expect(ADMIN_CLIENT_JS).toContain('/admin/api/links');
  });

  test('is valid JavaScript', () => {
    expect(() => new Function(ADMIN_CLIENT_JS)).not.toThrow();
  });
});
