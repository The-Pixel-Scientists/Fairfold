// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embed host's framing rules in a real browser (ADR 0035). An embed
// server from scripts/web-server.ts serves a synthetic embed page and reads
// the tenant's origins from a stub of the API's public route, both on this
// machine. Playwright answers for the https origins: two funder websites,
// and the embed host, whose pages come from that server with its headers
// unchanged, so the browser applies the server's own policy. The
// csp-console and csp-portal projects run this spec, so it also checks that
// the app at baseURL cannot be framed and never carries the embed policy.
//
// With TPS_E2E_EMBED_URL set to the embed host of a stack started with
// infra/compose/compose.embed.yaml, the last test checks the proxy's routes
// and cookies there too.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as base, request, type Page } from '@playwright/test';

import { apiOrigin, createEmbedServer, NONCE_PLACEHOLDER } from '../web-server.ts';
import { expect, test } from './fixtures.ts';

const EMBED = 'https://embed.example.net';
const ALLOWED = 'https://www.northfield.example';
const OTHER = 'https://elsewhere.example';
const FORM = '/northfield/forms/0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const LOADED = 'Synthetic form loaded';

const EMBED_PAGE = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Synthetic form</title><style nonce="${NONCE_PLACEHOLDER}">main { padding: 1rem; }</style><script type="module" src="/assets/form-1a2b.js"></script></head><body><main><h1>Synthetic form</h1><p id="status"></p></main></body></html>`;

/** Runs under script-src 'self', and calls a public tenant route under connect-src. */
const EMBED_SCRIPT = `document.getElementById('status').textContent = '${LOADED}';
void fetch('/api/public/tenants/northfield').catch(() => undefined);`;

/**
 * A funder's page, the same for every site and request: it frames the http
 * or https URL in its own ?src= through the DOM, so no server writes a
 * request value into HTML, and marks the body once the frame has loaded or
 * been refused.
 */
const FUNDER_SITE = `<!doctype html><html lang="en-GB"><title>Funder website</title><body><script>
const src = new URL(new URLSearchParams(location.search).get('src') ?? '');
if (src.protocol !== 'https:' && src.protocol !== 'http:') throw new Error('src must be an http or https URL');
const frame = document.createElement('iframe');
frame.title = 'Form';
frame.addEventListener('load', () => { document.body.dataset.framed = 'yes'; });
frame.src = src.href;
document.body.append(frame);
</script></body></html>`;

/** The address of a funder page that frames `src`. */
const framing = (page: string, src: string): string => `${page}?src=${encodeURIComponent(src)}`;

let folder: string;
let api: Server;
let embed: Server;
let embedServer: string;
/** Serves FUNDER_SITE for the app framing check, on loopback like the apps. */
let loopbackSite: string;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'tps-embed-origin-'));
  mkdirSync(join(folder, 'assets'));
  writeFileSync(join(folder, 'embed.html'), EMBED_PAGE);
  writeFileSync(join(folder, 'assets', 'form-1a2b.js'), EMBED_SCRIPT);

  api = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? '/', 'http://localhost');
    if (url.pathname === '/funder-site') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(FUNDER_SITE);
    } else if (url.pathname === '/api/public/tenants/northfield/embed-origins') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ origins: [ALLOWED] }));
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"status":404}');
    }
  });
  loopbackSite = await listen(api);
  embed = createEmbedServer(folder, new URL(EMBED), apiOrigin(loopbackSite));
  embedServer = await listen(embed);
});

test.afterAll(async () => {
  await new Promise((resolve) => embed.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  rmSync(folder, { recursive: true, force: true });
});

/**
 * Answer for the funder websites with FUNDER_SITE, and for the embed host:
 * its public tenant routes as the proxy would send them to the API, and
 * everything else from the embed server. Returns the embed paths asked for.
 */
async function routeSites(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(`${EMBED}/**`, async (route) => {
    const { pathname, search } = new URL(route.request().url());
    asked.push(pathname);
    if (pathname.startsWith('/api/public/tenants/')) {
      await route.fulfill({ json: { name: 'Northfield Foundation' } });
      return;
    }
    await route.fulfill({
      response: await route.fetch({ url: `${embedServer}${pathname}${search}` }),
    });
  });
  for (const site of [ALLOWED, OTHER]) {
    await page.route(
      (url) => url.origin === site,
      (route) => route.fulfill({ contentType: 'text/html', body: FUNDER_SITE }),
    );
  }
  return asked;
}

test('loads in a frame on a website the tenant allows, with no policy violation', async ({
  page,
}) => {
  const asked = await routeSites(page);

  await page.goto(framing(`${ALLOWED}/`, `${EMBED}${FORM}`));

  await expect(page.frameLocator('iframe').getByText(LOADED)).toBeVisible();
  await expect.poll(() => asked).toContain('/api/public/tenants/northfield');
});

for (const { name, site, path } of [
  { name: 'on another website', site: OTHER, path: FORM },
  { name: 'for a tenant with no allowed websites', site: ALLOWED, path: '/eastfield/forms/x' },
]) {
  base(`refuses to load in a frame ${name}`, async ({ page }) => {
    const asked = await routeSites(page);

    await page.goto(framing(`${site}/`, `${EMBED}${path}`));

    await expect(page.locator('body[data-framed="yes"]')).toBeAttached();
    expect(asked).toContain(path);
    await expect(page.frameLocator('iframe').getByText(LOADED)).toHaveCount(0);
  });
}

base('the app cannot be framed by any website', async ({ page, baseURL }) => {
  const app = new URL('/', baseURL).href;
  const answered = page.waitForResponse(app);

  await page.goto(framing(`${loopbackSite}/funder-site`, app));

  expect((await answered).headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.locator('body[data-framed="yes"]')).toBeAttached();
  await expect(page.frameLocator('iframe').locator('#root')).toHaveCount(0);
});

base('the app never sends the embed policy, even at an embed path', async ({ page, baseURL }) => {
  for (const path of [FORM, '/assets/missing-9z8y.js']) {
    const policy = (await page.goto(new URL(path, baseURL).href))?.headers()[
      'content-security-policy'
    ];
    expect(policy, path).toContain("frame-ancestors 'none'");
    expect(policy, path).not.toMatch(/connect-src|worker-src|frame-src/);
  }
});

base('through the proxy, forwards only the public routes and no cookie', async () => {
  const embedURL = process.env['TPS_E2E_EMBED_URL'];
  base.skip(embedURL === undefined, 'Needs a stack started with compose.embed.yaml.');
  // TLS on the embed host is the proxy's, as on the app hosts; this checks routing.
  const client = await request.newContext({
    baseURL: embedURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie: '__Host-session=abc' },
  });
  try {
    // The API sets X-Request-Id on every answer, so one without it never reached the API.
    for (const path of [
      '/api/auth/session',
      '/api/console/settings/embed-origins',
      '/api/public/tenants/northfield/embed-origins',
      '/api/public/tenants/northfield/rounds',
      '/api/public/unsubscribe',
      '/api/health',
      '/api',
      '/health',
      '/health/ready',
      '/openapi.json',
    ]) {
      const answer = await client.get(path);
      expect(answer.status(), path).toBe(404);
      expect(answer.headers()['x-request-id'], path).toBeUndefined();
      expect(answer.headers()['set-cookie'], path).toBeUndefined();
    }
    const tenant = await client.get('/api/public/tenants/northfield');
    expect(tenant.headers()['x-request-id']).toBeDefined();
    expect(tenant.headers()['set-cookie']).toBeUndefined();
  } finally {
    await client.dispose();
  }
});
