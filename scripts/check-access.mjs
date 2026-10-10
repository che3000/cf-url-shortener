import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function protectedOrigins(wranglerConfig) {
  const rootSettings = new Map();
  const routes = [];
  let section = 'root';

  for (const line of wranglerConfig.split(/\r?\n/)) {
    const heading = /^\s*(\[\[?[^\]]+\]\]?)\s*$/.exec(line);
    if (heading) {
      section = heading[1] === '[[routes]]' ? 'route' : 'other';
      if (section === 'route') routes.push(null);
      continue;
    }

    const setting = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!setting) continue;
    const [, key, value] = setting;
    if (section === 'root' && ['workers_dev', 'preview_urls', 'route', 'routes'].includes(key)) {
      if (rootSettings.has(key)) throw new Error(`Duplicate ${key} in wrangler.toml`);
      rootSettings.set(key, value);
    }
    if (section === 'route' && key === 'pattern') {
      const index = routes.length - 1;
      if (routes[index] !== null) throw new Error('Duplicate route pattern in wrangler.toml');
      routes[index] = value;
    }
  }

  for (const setting of ['workers_dev', 'preview_urls']) {
    if (rootSettings.get(setting) !== 'false') {
      throw new Error(`${setting} must be explicitly set to false in wrangler.toml`);
    }
  }
  if (rootSettings.has('route') || rootSettings.has('routes')) {
    throw new Error('Use [[routes]] in wrangler.toml so every production route can be verified');
  }

  if (routes.length === 0) throw new Error('No Worker routes found in wrangler.toml');

  return routes.map((value) => {
    const quoted = /^"([^"]+)"$/.exec(value ?? '');
    if (!quoted) throw new Error('Every [[routes]] entry needs a quoted pattern');
    const pattern = quoted[1];
    const match = /^([a-z0-9.-]+)\/\*$/i.exec(pattern);
    if (!match || match[1].includes('..') || match[1].includes('<')) {
      throw new Error(`Cannot verify Worker route: ${pattern}`);
    }
    return `https://${match[1]}`;
  });
}

export function isAccessDenial(response, origin) {
  if (response.status === 401 || response.status === 403) return true;
  if (![302, 303, 307, 308].includes(response.status)) return false;

  const location = response.headers.get('location');
  if (!location) return false;
  const target = new URL(location, origin);
  const source = new URL(origin);
  return target.protocol === 'https:' &&
    target.pathname.startsWith('/cdn-cgi/access/login') &&
    (target.hostname === source.hostname || target.hostname.endsWith('.cloudflareaccess.com'));
}

export async function checkAccess(origins, request = fetch) {
  const unavailableCode = `access-probe-${'x'.repeat(80)}`;
  const probes = [
    { method: 'GET', path: '/admin' },
    { method: 'GET', path: '/admin/api/links' },
    { method: 'POST', path: '/admin/api/links', body: '{}' },
    { method: 'PATCH', path: `/admin/api/links/${unavailableCode}`, body: '{}' },
    { method: 'GET', path: '/api/links' },
    { method: 'POST', path: '/api/links', body: '{}' },
    { method: 'PATCH', path: `/api/links/${unavailableCode}`, body: '{}' },
  ];

  for (const origin of origins) {
    for (const probe of probes) {
      const response = await request(`${origin}${probe.path}`, {
        method: probe.method,
        body: probe.body,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      response.body?.cancel();
      if (!isAccessDenial(response, origin)) {
        throw new Error(`${origin}${probe.path} allowed unauthenticated ${probe.method} (HTTP ${response.status})`);
      }
    }
  }
}

async function main() {
  const config = await readFile('wrangler.toml', 'utf8');
  const origins = protectedOrigins(config);
  await checkAccess(origins);
  console.log(`Access denied unauthenticated management requests on ${origins.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Access pre-deploy check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
