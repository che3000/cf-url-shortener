import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAccess, isAccessDenial, protectedOrigins } from './check-access.mjs';

const config = `workers_dev = false
preview_urls = false
[[routes]]
pattern = "s.example.com/*"`;

test('requires both alternate Worker URLs to be disabled', () => {
  assert.deepEqual(protectedOrigins(config), ['https://s.example.com']);
  assert.throws(() => protectedOrigins(config.replace('preview_urls = false', '')), /preview_urls/);
  assert.throws(() => protectedOrigins(config.replace('workers_dev = false', 'workers_dev = true')), /workers_dev/);
});

test('does not use environment settings or routes for the production deployment', () => {
  const mixedConfig = `workers_dev = true
preview_urls = true
routes = ["s.unprotected.example/*"]
[env.staging]
workers_dev = false
preview_urls = false
[[env.staging.routes]]
pattern = "s.protected.example/*"`;
  assert.throws(() => protectedOrigins(mixedConfig), /workers_dev/);
  assert.deepEqual(
    protectedOrigins(config + '\n[[env.staging.routes]]\npattern = "s.staging.example/*"'),
    ['https://s.example.com'],
  );
  assert.throws(
    () => protectedOrigins(config.replace('[[routes]]\npattern = "s.example.com/*"', 'routes = ["s.example.com/*"]')),
    /Use \[\[routes\]\]/,
  );
});

test('accepts Access denial, but not an ordinary Worker response', async () => {
  const requests = [];
  await checkAccess(['https://s.example.com'], async (url, options) => {
    requests.push([url, options.method]);
    return new Response(null, { status: 403 });
  });
  assert.equal(requests.length, 7);
  assert.deepEqual(new Set(requests.map(([, method]) => method)), new Set(['GET', 'POST', 'PATCH']));

  await assert.rejects(
    checkAccess(['https://s.example.com'], async () => new Response(null, { status: 400 })),
    /allowed unauthenticated GET/,
  );
  await assert.rejects(
    checkAccess(['https://s.example.com'], async (url) => new Response(null, {
      status: url.endsWith('/admin') ? 200 : 403,
    })),
    /\/admin allowed unauthenticated GET/,
  );
  await assert.rejects(
    checkAccess(['https://s.example.com'], async (url, options) => new Response(null, {
      status: url.endsWith('/api/links') && options.method === 'POST' ? 400 : 403,
    })),
    /\/api\/links allowed unauthenticated POST/,
  );
  assert.equal(isAccessDenial(new Response(null, {
    status: 302,
    headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/s.example.com' },
  }), 'https://s.example.com'), true);
  assert.equal(isAccessDenial(new Response(null, {
    status: 302,
    headers: { location: 'https://attacker.example/cdn-cgi/access/login' },
  }), 'https://s.example.com'), false);
});
