// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiOrigin, createWebServer, isApiRequest, NONCE_PLACEHOLDER } from './web-server.ts';

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
