// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiOrigin,
  contentSecurityPolicy,
  createEmbedServer,
  createWebServer,
  EMBED_ORIGINS_TTL_MS,
  embedContentSecurityPolicy,
  embedOrigin,
  embedOriginReader,
  isApiRequest,
  isEmbedOrigin,
  NONCE_PLACEHOLDER,
} from './web-server.ts';

const PAGE = `<!doctype html><html><head><meta property="csp-nonce" nonce="${NONCE_PLACEHOLDER}" /><script type="module" nonce="${NONCE_PLACEHOLDER}" src="/assets/app-1a2b.js"></script></head><body></body></html>`;

let folder: string;
let server: Server;
let port: number;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'tps-web-server-'));
  const root = join(folder, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), PAGE);
  writeFileSync(join(root, 'assets', 'app-1a2b.js'), 'console.log("app");');
  writeFileSync(join(root, 'assets', 'app-3c4d.css'), 'body { margin: 0; }');
  writeFileSync(join(root, 'robots.txt'), 'User-agent: *');
  writeFileSync(join(folder, 'secret.txt'), 'not for the browser');

  server = createWebServer(root);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(folder, { recursive: true, force: true });
});

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A raw request, so the path reaches the server exactly as written. */
function get(path: string, method = 'GET'): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function nonceOf(policy: IncomingHttpHeaders[string]): string | undefined {
  return /'nonce-([^']+)'/.exec(String(policy))?.[1];
}

describe('createWebServer', () => {
  it('sends index.html with a fresh nonce in the policy and the page, and never caches it', async () => {
    const first = await get('/');
    const second = await get('/');

    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(first.headers['cache-control']).toBe('no-store');
    const nonce = nonceOf(first.headers['content-security-policy']);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.body).not.toContain(NONCE_PLACEHOLDER);
    expect(first.body.split(`nonce="${String(nonce)}"`)).toHaveLength(3);
    expect(nonceOf(second.headers['content-security-policy'])).not.toBe(nonce);
  });

  it('sends the policy of ADR 0006, with a nonce for styles and none for scripts', async () => {
    const { headers } = await get('/');
    const nonce = String(nonceOf(headers['content-security-policy']));
    expect(headers['content-security-policy']).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        `style-src 'self' 'nonce-${nonce}'`,
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
    );
  });

  it('sends the security headers on every response', async () => {
    for (const path of ['/', '/assets/app-1a2b.js', '/robots.txt', '/assets/missing.js']) {
      const { headers } = await get(path);
      expect(headers, path).toMatchObject({
        'strict-transport-security': 'max-age=63072000; includeSubDomains',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
        'cross-origin-opener-policy': 'same-origin',
      });
      expect(headers['content-security-policy'], path).toContain("script-src 'self';");
    }
  });

  it('sends index.html for any path without a file extension, so the router can answer', async () => {
    for (const path of ['/programmes', '/northfield/apply/', '/index.html']) {
      const answer = await get(path);
      expect(answer.status, path).toBe(200);
      expect(answer.body, path).toContain('<!doctype html>');
      expect(nonceOf(answer.headers['content-security-policy']), path).toBeDefined();
    }
  });

  it('sends built files with their type, caching hashed assets for good', async () => {
    const script = await get('/assets/app-1a2b.js');
    expect(script).toMatchObject({ status: 200, body: 'console.log("app");' });
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(script.headers['content-security-policy']).toContain("style-src 'self';");

    const styles = await get('/assets/app-3c4d.css');
    expect(styles.headers['content-type']).toBe('text/css; charset=utf-8');

    const robots = await get('/robots.txt');
    expect(robots.headers['cache-control']).toBe('no-cache');
  });

  it('answers 404 for a missing file rather than sending the page', async () => {
    const answer = await get('/assets/missing-9z8y.js');
    expect(answer.status).toBe(404);
    expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('serves nothing from outside the build', async () => {
    for (const path of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/assets/../../secret.txt',
    ]) {
      const answer = await get(path);
      expect(answer.body, path).not.toContain('not for the browser');
      expect(answer.status, path).toBe(404);
    }
  });

  it('answers 400 for a path that cannot be decoded', async () => {
    expect((await get('/%E0%A4%A')).status).toBe(400);
  });

  it('answers HEAD with headers only, and refuses other methods', async () => {
    const head = await get('/assets/app-1a2b.js', 'HEAD');
    expect(head).toMatchObject({ status: 200, body: '' });
    expect(head.headers['content-length']).toBe('19');

    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const answer = await get('/', method);
      expect(answer.status, method).toBe(405);
      expect(answer.headers['allow'], method).toBe('GET, HEAD');
    }
  });

  it('refuses to start without a built index.html', () => {
    expect(() => createWebServer(folder)).toThrow('has no index.html. Build the app first.');
  });
});

describe('isApiRequest', () => {
  it('takes /api and paths under /api/, as sent and once resolved', () => {
    for (const url of [
      '/api',
      '/api/',
      '/api/auth/session',
      '/api/programmes?page=2',
      '/api?x=1',
    ]) {
      expect(isApiRequest(url), url).toBe(true);
    }
    for (const url of [
      '/',
      '/apis',
      '/api-docs',
      '/health',
      '/health/ready',
      '/openapi.json',
      '/api/../health',
      '/api/%2e%2e/health',
      '/api/%2E%2E/openapi.json',
      '/console/api/x',
      '//api/x',
      'http://localhost/api/x',
    ]) {
      expect(isApiRequest(url), url).toBe(false);
    }
  });
});

describe('apiOrigin', () => {
  it('takes only a plain HTTP origin', () => {
    expect(apiOrigin('http://api:3000').href).toBe('http://api:3000/');
    for (const value of [
      'https://api:3000',
      'http://api:3000/api',
      'http://user:secret@api:3000',
      'http://api:3000/?x=1',
      'file:///etc/passwd',
    ]) {
      expect(() => apiOrigin(value), value).toThrow('--api must be an origin');
    }
  });
});

describe('createWebServer with an API', () => {
  interface Received {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    body: string;
  }
  const received: Received[] = [];
  let api: Server;
  let proxy: Server;

  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  beforeAll(async () => {
    api = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        received.push({
          method: incoming.method ?? '',
          url: incoming.url ?? '',
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(201, {
          'content-type': 'application/json',
          'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
          'set-cookie': ['a=1; HttpOnly', 'b=2; HttpOnly'],
        });
        response.end('{"ok":true}');
      });
    });
    const apiPort = await listen(api);
    proxy = createWebServer(join(folder, 'dist'), apiOrigin(`http://127.0.0.1:${String(apiPort)}`));
    await listen(proxy);
  });

  afterAll(async () => {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => api.close(resolve));
  });

  function send(
    server: Server,
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Answer> {
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          path,
          method: options.method ?? 'GET',
          headers: options.headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(options.body);
    });
  }

  it('passes a request under /api/ to the API unchanged, with its own forwarding headers', async () => {
    received.length = 0;
    const answer = await send(proxy, '/api/auth/tenants/northfield/sign-in?next=%2Fhome', {
      method: 'POST',
      headers: {
        Host: 'console.localhost:41231',
        Origin: 'http://console.localhost:41231',
        'Content-Type': 'application/json',
        Cookie: 'session=abc',
        'X-Forwarded-For': '203.0.113.9',
        'X-Forwarded-Host': 'portal.localhost',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Port': '443',
        Forwarded: 'for=203.0.113.9;host=portal.localhost',
        Connection: 'keep-alive, X-Hop',
        'X-Hop': 'for this connection only',
      },
      body: '{"email":"a@example.org"}',
    });

    expect(answer).toMatchObject({ status: 201, body: '{"ok":true}' });
    expect(answer.headers['set-cookie']).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly']);
    expect(answer.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(answer.headers['x-content-type-options']).toBe('nosniff');

    expect(received).toHaveLength(1);
    const [seen] = received;
    expect(seen).toMatchObject({
      method: 'POST',
      url: '/api/auth/tenants/northfield/sign-in?next=%2Fhome',
      body: '{"email":"a@example.org"}',
    });
    expect(seen?.headers).toMatchObject({
      host: 'console.localhost:41231',
      origin: 'http://console.localhost:41231',
      'content-type': 'application/json',
      cookie: 'session=abc',
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-host': 'console.localhost:41231',
      'x-forwarded-proto': 'http',
    });
    for (const name of ['x-forwarded-port', 'forwarded', 'x-hop']) {
      expect(seen?.headers[name], name).toBeUndefined();
    }
  });

  it('keeps the probes, the OpenAPI document and the pages away from the API', async () => {
    received.length = 0;
    for (const path of ['/health', '/health/ready', '/api/../health', '/apis', '/programmes']) {
      const answer = await send(proxy, path);
      expect(answer.status, path).toBe(200);
      expect(answer.body, path).toContain('<!doctype html>');
    }
    expect((await send(proxy, '/openapi.json')).status).toBe(404);
    expect(received).toEqual([]);
  });

  it('answers 502 with the security headers when the API does not answer', async () => {
    const closed = createServer();
    const closedPort = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const down = createWebServer(
      join(folder, 'dist'),
      apiOrigin(`http://127.0.0.1:${String(closedPort)}`),
    );
    await listen(down);
    try {
      const answer = await send(down, '/api/health');
      expect(answer.status).toBe(502);
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
      expect(answer.headers['content-security-policy']).toContain("default-src 'self'");
    } finally {
      await new Promise((resolve) => down.close(resolve));
    }
  });
});

/** A raw request to `port`, with the headers given as sent. */
function ask(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('the embed host', () => {
  const EMBED = new URL('https://embed.example.net');
  const FORM = '/northfield/forms/0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
  const ALLOWED = ['https://www.northfield.example', 'https://northfield.example:8443'];
  const NOT_EMBEDDABLE =
    'We cannot find this form. Check the link for typing mistakes, or ask the organisation that shared it.\n';
  const UNAVAILABLE = 'This form cannot be shown at the moment. Try again in a few minutes.\n';

  /** The stub API's answer for each slug: a slug not listed gets 404. */
  const answers = new Map<string, { status: number; body: string } | 'hang' | 'drop'>();
  const lookups: { url: string; headers: IncomingHttpHeaders }[] = [];
  const list = (origins: unknown) => ({ status: 200, body: JSON.stringify({ origins }) });
  let embedFolder: string;
  let api: Server;
  let apiURL: URL;
  let embed: Server;
  let embedPort: number;

  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  const get = (path: string, headers?: Record<string, string>, method?: string) =>
    ask(embedPort, path, headers, method);

  beforeAll(async () => {
    embedFolder = mkdtempSync(join(tmpdir(), 'tps-embed-server-'));
    mkdirSync(join(embedFolder, 'assets'));
    writeFileSync(join(embedFolder, 'embed.html'), PAGE.replace('<body>', '<body>embed entry'));
    writeFileSync(join(embedFolder, 'index.html'), PAGE.replace('<body>', '<body>portal shell'));
    writeFileSync(join(embedFolder, 'assets', 'embed-1a2b.js'), 'console.log("embed");');
    writeFileSync(join(embedFolder, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    answers.set('northfield', list(ALLOWED));
    api = createServer((incoming, response) => {
      lookups.push({ url: incoming.url ?? '', headers: incoming.headers });
      const slug = /^\/api\/public\/tenants\/([^/]+)\/embed-origins$/.exec(incoming.url ?? '')?.[1];
      const answer = answers.get(slug ?? '');
      if (answer === 'hang') return;
      if (answer === 'drop') {
        incoming.socket.destroy();
        return;
      }
      response.writeHead(answer?.status ?? 404, {
        'content-type': 'application/json',
        'set-cookie': 'api=1; HttpOnly',
      });
      response.end(answer?.body ?? '{"status":404}');
    });
    apiURL = apiOrigin(`http://127.0.0.1:${String(await listen(api))}`);
    embed = createEmbedServer(embedFolder, EMBED, apiURL);
    embedPort = await listen(embed);
  });

  afterAll(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => embed.close(resolve));
    await new Promise((resolve) => api.close(resolve));
    rmSync(embedFolder, { recursive: true, force: true });
  });

  it("sends the embed page under a slug, framed only by that tenant's origins, with a fresh nonce", async () => {
    const first = await get(FORM);
    const second = await get(FORM);

    expect(first.status).toBe(200);
    expect(first.body).toContain('embed entry');
    expect(first.body).not.toContain(NONCE_PLACEHOLDER);
    expect(first.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(first.headers['cache-control']).toBe('no-store');
    const nonce = String(nonceOf(first.headers['content-security-policy']));
    expect(first.body.split(`nonce="${nonce}"`)).toHaveLength(3);
    expect(first.headers['content-security-policy']).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self'",
        "font-src 'self'",
        'connect-src https://embed.example.net/api/public/tenants/',
        "worker-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        'frame-ancestors https://www.northfield.example https://northfield.example:8443',
      ].join('; '),
    );
    expect(nonceOf(second.headers['content-security-policy'])).not.toBe(nonce);
  });

  it('keeps the security headers, and sends no X-Frame-Options or cookie, on every response', async () => {
    const paths = [
      FORM,
      '/assets/embed-1a2b.js',
      '/favicon.svg',
      '/',
      '/index.html',
      '/embed.html',
      '/assets/missing.js',
      '/api/auth/session',
      '/nowhere/forms/x',
      '/%E0%A4%A',
    ];
    const sent = [
      ...(await Promise.all(paths.map((path) => get(path)))),
      await get(FORM, {}, 'POST'),
    ];
    for (const [index, { headers }] of sent.entries()) {
      const name = paths[index] ?? 'POST';
      expect(headers['set-cookie'], name).toBeUndefined();
      expect(headers['x-frame-options'], name).toBeUndefined();
      expect(headers, name).toMatchObject({
        'strict-transport-security': 'max-age=63072000; includeSubDomains',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
        'cross-origin-opener-policy': 'same-origin',
      });
      expect(headers['content-security-policy'], name).toContain(
        'connect-src https://embed.example.net/api/public/tenants/;',
      );
    }
  });

  it('serves files under the embed policy, and a page only as the embed page under a slug', async () => {
    const script = await get('/assets/embed-1a2b.js');
    expect(script).toMatchObject({ status: 200, body: 'console.log("embed");' });
    expect(script.headers['content-security-policy']).toBe(embedContentSecurityPolicy(EMBED));

    lookups.length = 0;
    for (const path of [
      '/',
      '/index.html',
      '/embed.html',
      '/Northfield/forms',
      '/nf/forms',
      '/a.js',
    ]) {
      const answer = await get(path);
      expect(answer, path).toMatchObject({ status: 404, body: 'Not found.\n' });
      expect(answer.headers['content-security-policy'], path).toBe(
        embedContentSecurityPolicy(EMBED),
      );
    }
    expect(lookups).toEqual([]);
  });

  it('forwards nothing, and asks the API only for origins', async () => {
    lookups.length = 0;
    for (const path of [
      '/api',
      '/api/auth/session',
      '/api/public/tenants/northfield',
      '/api/public/tenants/northfield/embed-origins',
      '/health',
      '/health/ready',
      '/openapi.json',
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect((await get('/api/auth/session', {}, 'POST')).status).toBe(405);
    for (const { url } of lookups) {
      expect(url).toMatch(/^\/api\/public\/tenants\/[a-z0-9-]+\/embed-origins$/);
    }
  });

  it('asks as the embed host with no cookie, and takes the tenant from the path alone', async () => {
    answers.set('eastfield', list(['https://eastfield.example']));
    lookups.length = 0;

    const answer = await get('/eastfield/forms/x?slug=northfield&tenant=northfield', {
      Host: 'northfield.example',
      Cookie: '__Host-session=abc',
      Origin: 'https://www.northfield.example',
      Referer: 'https://www.northfield.example/',
      'X-Forwarded-Host': 'www.northfield.example',
      'X-Tenant': 'northfield',
    });

    expect(answer.headers['content-security-policy']).toMatch(
      /; frame-ancestors https:\/\/eastfield\.example$/,
    );
    expect(lookups).toHaveLength(1);
    const [lookup] = lookups;
    expect(lookup?.url).toBe('/api/public/tenants/eastfield/embed-origins');
    expect(lookup?.headers.host).toBe('embed.example.net');
    for (const name of ['cookie', 'origin', 'referer', 'x-forwarded-host', 'x-tenant']) {
      expect(lookup?.headers[name], name).toBeUndefined();
    }
  });

  it('asks for the client the proxy named, or else for the connection', async () => {
    answers.set('oakfield', list(['https://oak.example']));
    answers.set('ashfield', list(['https://ash.example']));
    answers.set('elmfield', list(['https://elm.example']));
    lookups.length = 0;

    await get('/oakfield/forms/x', { 'X-Forwarded-For': '198.51.100.7' });
    await get('/ashfield/forms/x', { 'X-Forwarded-For': '198.51.100.7, 203.0.113.9' });
    await get('/elmfield/forms/x');

    expect(lookups.map(({ headers }) => headers['x-forwarded-for'])).toEqual([
      '198.51.100.7',
      '127.0.0.1',
      '127.0.0.1',
    ]);
  });

  it("keeps a known tenant's page up through a flood of made-up slugs", async () => {
    // Like the API's public limit: 120 a minute for each client.
    const counts = new Map<string, number>();
    let eastfieldLookups = 0;
    const limited = createServer((incoming, response) => {
      const client = String(incoming.headers['x-forwarded-for'] ?? incoming.socket.remoteAddress);
      counts.set(client, (counts.get(client) ?? 0) + 1);
      if ((counts.get(client) ?? 0) > 120) {
        response.writeHead(429).end();
      } else if (incoming.url === '/api/public/tenants/eastfield/embed-origins') {
        eastfieldLookups++;
        response.end(JSON.stringify({ origins: ['https://eastfield.example'] }));
      } else {
        response.writeHead(404).end();
      }
    });
    const flooded = createEmbedServer(
      embedFolder,
      EMBED,
      apiOrigin(`http://127.0.0.1:${String(await listen(limited))}`),
    );
    const floodedPort = await listen(flooded);
    const flood = async (prefix: string, count: number, client: (index: number) => string) => {
      for (let start = 0; start < count; start += 50) {
        await Promise.all(
          Array.from({ length: Math.min(50, count - start) }, (_, offset) =>
            ask(floodedPort, `/${prefix}-${String(start + offset)}/forms/x`, {
              'X-Forwarded-For': client(start + offset),
            }),
          ),
        );
      }
    };
    const eastfield = () =>
      ask(floodedPort, '/eastfield/forms/x', { 'X-Forwarded-For': '198.51.100.7' });

    try {
      await flood('made-up', 125, () => '203.0.113.9');
      const first = await eastfield();
      expect(first.status).toBe(200);
      expect(first.headers['content-security-policy']).toMatch(
        /; frame-ancestors https:\/\/eastfield\.example$/,
      );

      await flood('made-again', 1_100, (index) => `192.0.2.${String(index % 100)}`);
      expect((await eastfield()).status).toBe(200);
      expect(eastfieldLookups).toBe(1);
    } finally {
      limited.closeAllConnections();
      await new Promise((resolve) => flooded.close(resolve));
      await new Promise((resolve) => limited.close(resolve));
    }
  }, 30_000);

  it('answers the one 404, framed by nobody, for a slug without a list of valid origins', async () => {
    const refused = {
      emptyfield: list([]),
      injectfield: list(['https://ok.example', 'https://evil.example; script-src *']),
      starfield: list(['*']),
      selffield: list(["'self'"]),
      pathfield: list(['https://ok.example/forms']),
      wildfield: list(['https://*.ok.example']),
      plainfield: list(['http://ok.example']),
      spacefield: list(['https://ok.example https://evil.example']),
      commafield: list(['https://ok.example,https://evil.example']),
      quotefield: list(["https://ok.example'"]),
      casefield: list(['https://OK.example']),
      longfield: list(
        Array.from({ length: 21 }, (_, index) => `https://s${String(index)}.example`),
      ),
      extrafield: { status: 200, body: JSON.stringify({ origins: ['https://ok.example'], id: 1 }) },
      textfield: { status: 200, body: 'https://ok.example' },
      nullfield: { status: 200, body: 'null' },
    };
    for (const [slug, answer] of Object.entries(refused)) answers.set(slug, answer);

    for (const slug of ['nowhere', ...Object.keys(refused)]) {
      const answer = await get(`/${slug}/forms/x`);
      expect(answer, slug).toMatchObject({ status: 404, body: NOT_EMBEDDABLE });
      expect(answer.headers['content-security-policy'], slug).toBe(
        embedContentSecurityPolicy(EMBED),
      );
    }
  });

  it('answers 503, framed by nobody, when the API fails, drops the request or is slow', async () => {
    answers.set('errorfield', { status: 500, body: '{}' });
    answers.set('movedfield', { status: 302, body: '' });
    answers.set('dropfield', 'drop');
    answers.set('slowfield', 'hang');
    const closed = createServer();
    const closedPort = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const down = createEmbedServer(
      embedFolder,
      EMBED,
      apiOrigin(`http://127.0.0.1:${String(closedPort)}`),
    );
    const downPort = await listen(down);

    try {
      const started = Date.now();
      const failed = await Promise.all([
        ...['errorfield', 'movedfield', 'dropfield', 'slowfield'].map((slug) =>
          get(`/${slug}/forms/x`),
        ),
        ask(downPort, FORM),
      ]);
      expect(Date.now() - started).toBeLessThan(5_000);
      for (const answer of failed) {
        expect(answer).toMatchObject({ status: 503, body: UNAVAILABLE });
        expect(answer.headers['content-security-policy']).toBe(embedContentSecurityPolicy(EMBED));
      }
    } finally {
      await new Promise((resolve) => down.close(resolve));
    }
  }, 10_000);

  it("keeps a slug's origins for a minute, so a removed origin is refused within one", async () => {
    let clock = 0;
    const read = embedOriginReader(apiURL, 'embed.example.net', () => clock);
    answers.set('westfield', list(['https://a.example', 'https://b.example']));
    lookups.length = 0;

    expect(await read('westfield')).toEqual(['https://a.example', 'https://b.example']);
    answers.set('westfield', list(['https://a.example']));
    clock = EMBED_ORIGINS_TTL_MS - 1;
    expect(await read('westfield')).toEqual(['https://a.example', 'https://b.example']);
    clock = EMBED_ORIGINS_TTL_MS;
    expect(await read('westfield')).toEqual(['https://a.example']);
    expect(lookups).toHaveLength(2);
  });

  it('asks once for requests that arrive together, and again after a failure', async () => {
    const read = embedOriginReader(apiURL, 'embed.example.net');
    answers.set('southfield', { status: 500, body: '' });
    lookups.length = 0;

    expect(await Promise.all([read('southfield'), read('southfield')])).toEqual([null, null]);
    expect(lookups).toHaveLength(1);
    answers.set('southfield', list(['https://south.example']));
    expect(await read('southfield')).toEqual(['https://south.example']);
    expect(lookups).toHaveLength(2);
  });

  it('refuses to start without a built embed.html', () => {
    expect(() => createEmbedServer(join(folder, 'dist'), EMBED, apiURL)).toThrow(
      'has no embed.html. Build the portal first.',
    );
  });
});

describe('embedContentSecurityPolicy', () => {
  const EMBED = new URL('https://embed.example.net');

  it("writes 'none' for a list that is empty, too long or holds anything but an origin", () => {
    const none = embedContentSecurityPolicy(EMBED);
    expect(none).toMatch(/; frame-ancestors 'none'$/);
    for (const ancestors of [
      [],
      ['*'],
      ["'self'"],
      ['https://a.example', 'https://b.example; script-src *'],
      ['https://a.example https://b.example'],
      [42],
      Array.from({ length: 21 }, (_, index) => `https://s${String(index)}.example`),
    ]) {
      expect(embedContentSecurityPolicy(EMBED, undefined, ancestors)).toBe(none);
    }
    expect(
      embedContentSecurityPolicy(EMBED, undefined, ['https://a.example', 'https://b.example:8443']),
    ).toBe(none.replace(/'none'$/, 'https://a.example https://b.example:8443'));
  });
});

describe('isEmbedOrigin', () => {
  it('takes exactly the stored origins that the domain package accepts', async () => {
    // Imported at run time: the server itself may use Node.js built-ins alone.
    const domain = (await import(
      new URL('../packages/domain/src/platform/settings/embed-origins.ts', import.meta.url).href
    )) as {
      embedOriginSchema: { safeParse(value: unknown): { success: boolean; data?: unknown } };
    };
    for (const value of [
      'https://example.org',
      'https://www.example.org',
      'https://grants.example.co.uk:8443',
      'https://xn--bcher-kva.example',
      'https://a.example.org:65535',
      'HTTPS://WWW.EXAMPLE.ORG',
      ' https://www.example.org',
      'https://www.example.org\n',
      '',
      'http://www.example.org',
      'https://www.example.org/',
      'https://www.example.org?a=1',
      'https://user@www.example.org',
      'https://*.example.org',
      '*',
      "'self'",
      "https://www.example.org'",
      'https://www.example.org https://evil.example',
      'https://www.example.org,https://evil.example',
      'https://www.example.org;script-src *',
      'https://127.0.0.1',
      'https://[::1]',
      'https://localhost',
      'https://www.example.org:0',
      'https://www.example.org:65536',
      `https://${'a'.repeat(64)}.example.org`,
      `https://${'a.'.repeat(130)}org`,
      42,
      null,
    ]) {
      const parsed = domain.embedOriginSchema.safeParse(value);
      expect(isEmbedOrigin(value), String(value)).toBe(parsed.success && parsed.data === value);
    }
  });
});

describe('embedOrigin', () => {
  it('takes only an https origin', () => {
    expect(embedOrigin('https://embed.example.net').href).toBe('https://embed.example.net/');
    for (const value of [
      'http://embed.example.net',
      'https://embed.example.net/forms',
      'https://user@embed.example.net',
      'https://embed.example.net/?x=1',
    ]) {
      expect(() => embedOrigin(value), value).toThrow('--embed must be an origin');
    }
  });
});

describe('the console and portal policy', () => {
  it('never carries the embed policy, at any path', async () => {
    for (const path of ['/', '/northfield/forms/x', '/assets/app-1a2b.js', '/assets/missing.js']) {
      const policy = String((await get(path)).headers['content-security-policy']);
      expect(policy, path).toBe(contentSecurityPolicy(nonceOf(policy)));
    }
  });
});
