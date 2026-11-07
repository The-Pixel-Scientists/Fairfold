// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reverse proxy's controls (ADR 0030), checked against the stack's
// published ports with raw requests, so no client tidies a path or a header
// first. Every API answer carries X-Request-Id, so an answer without one
// came from the proxy. No page is opened, so no browser starts.
//
// The tests run in order, and the upload burst goes last: it spends this
// address's upload allowance, then waits for it to fill again.

import { readFileSync } from 'node:fs';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

import { expect, test } from '@playwright/test';

import { currentDevNames } from '../../scripts/dev-names.ts';
import { STACK_CERTIFICATE } from '../../scripts/stack.ts';

interface Site {
  host: string;
  port: number;
}

interface Answer {
  status: number;
  headers: Map<string, string>;
  body: string;
}

const { ports } = currentDevNames();
const consoleSite: Site = { host: 'console.localhost', port: ports.stackConsole };
const portalSite: Site = { host: 'portal.localhost', port: ports.stackPortal };
/** The proxy's plain HTTP port, which only redirects. */
const plainPort = ports.stackApi;
const MiB = 1024 * 1024;
/** How long the upload allowance takes to fill again: a burst of 10 at one every 2 seconds. */
const UPLOAD_REFILL_MS = 22_000;

/** A TLS connection to the proxy, checked against the stack's own certificate. */
function connect(site: Site, servername = site.host): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls(
      { host: '127.0.0.1', port: site.port, servername, ca: readFileSync(STACK_CERTIFICATE) },
      () => {
        resolve(socket);
      },
    );
    socket.once('error', reject);
  });
}

function connectPlain(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: '127.0.0.1', port: plainPort }, () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/** A request's head, with any `extra` text after it. */
function head(
  site: Site,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  extra = '',
): string {
  const lines = Object.entries({
    host: `${site.host}:${String(site.port)}`,
    connection: 'close',
    ...headers,
  }).map(([name, value]) => `${name}: ${value}\r\n`);
  return `${method} ${path} HTTP/1.1\r\n${lines.join('')}\r\n${extra}`;
}

/**
 * Send `text` and read the first answer. Unless `readBody`, it ends with its
 * headers, so the unsent body of a refused request is never waited for. A
 * connection closed or reset with no answer rejects.
 */
function exchange(socket: Socket, text: string, readBody = false): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let received = '';
    const finish = () => {
      socket.destroy();
      const end = received.indexOf('\r\n\r\n');
      if (end < 0) {
        reject(new Error(`No answer: ${JSON.stringify(received)}`));
        return;
      }
      const [statusLine = '', ...lines] = received.slice(0, end).split('\r\n');
      const headers = new Map(
        lines.map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()] as const;
        }),
      );
      resolve({ status: Number(statusLine.split(' ')[1]), headers, body: received.slice(end + 4) });
    };
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (!readBody && received.includes('\r\n\r\n')) finish();
    });
    // A reset is no answer too.
    socket.once('error', finish);
    socket.once('close', finish);
    socket.write(text);
  });
}

async function call(site: Site, text: string, readBody = false): Promise<Answer> {
  return exchange(await connect(site), text, readBody);
}

/** The nonce in an answer's Content-Security-Policy. */
function nonceOf(answer: Answer): string {
  const nonce = /'nonce-([^']+)'/.exec(answer.headers.get('content-security-policy') ?? '')?.[1];
  if (nonce === undefined) throw new Error('The answer has no nonce.');
  return nonce;
}

test('refuses every encoded, dotted or empty path segment before any route', async () => {
  const refused = [
    '/api/a%2Fb',
    '/api/a%2fb',
    '/api/a%5Cb',
    '/api/a%00',
    '/api/%2e%2e/auth/session',
    '/api/%2E/auth/session',
    '/api//auth/session',
    '/api/./auth/session',
    '/api/x/../auth/session',
    '/api/x/..',
    '/api/x/.?next=1',
    '/api/forms/x/..%2Ffiles',
    '//api/auth/session',
    '/portal//x',
    '/./index.html',
  ];
  for (const path of refused) {
    const answer = await call(consoleSite, head(consoleSite, 'GET', path));
    expect.soft(answer.status, path).toBe(400);
    expect.soft(answer.headers.has('x-request-id'), path).toBe(false);
  }

  // The same forms in the query string are the API's to judge.
  const query = await call(
    consoleSite,
    head(consoleSite, 'GET', '/api/auth/session?next=%2F..%2F'),
  );
  expect(query.headers.has('x-request-id')).toBe(true);
});

test('keeps its internal routes to itself', async () => {
  for (const path of ['/.api', '/.session']) {
    const answer = await call(consoleSite, head(consoleSite, 'GET', path));
    expect.soft(answer.status, path).toBe(404);
    expect.soft(answer.headers.has('x-request-id'), path).toBe(false);
  }
});

test('refuses an upload with no session before reading its body', async () => {
  const answer = await call(
    consoleSite,
    head(consoleSite, 'POST', '/api/grants/applications/x/files', {
      'content-type': 'application/octet-stream',
      'content-length': String(5 * MiB),
      expect: '100-continue',
    }),
  );
  // The first answer, so no 100 Continue came before it.
  expect(answer.status).toBe(401);
});

test('refuses bodies over 1 MiB, and uploads over 10 MiB, before the API', async () => {
  const cases = [
    ['POST', '/api/auth/sign-in/email', { 'content-length': String(MiB + 1) }, '', 413],
    // A chunk's size and its first bytes are enough to refuse it.
    [
      'POST',
      '/api/auth/sign-in/email',
      { 'transfer-encoding': 'chunked' },
      `${(MiB + 1).toString(16)}\r\n${'a'.repeat(1000)}`,
      413,
    ],
    ['PUT', '/api/grants/applications/x/files', { 'content-length': String(MiB + 1) }, '', 413],
    [
      'POST',
      '/api/grants/applications/x/files',
      { 'content-length': String(10 * MiB + 1) },
      '',
      413,
    ],
    // At the limit, the upload goes on to the session check.
    ['POST', '/api/grants/applications/x/files', { 'content-length': String(10 * MiB) }, '', 401],
  ] as const;
  for (const [method, path, headers, extra, status] of cases) {
    const name = `${method} ${path} ${JSON.stringify(headers)}`;
    const answer = await call(consoleSite, head(consoleSite, method, path, headers, extra));
    expect.soft(answer.status, name).toBe(status);
    expect.soft(answer.headers.has('x-request-id'), name).toBe(false);
  }
});

test('gives the web servers reads only', async () => {
  const answer = await call(portalSite, head(portalSite, 'POST', '/', { 'content-length': '0' }));
  expect(answer.status).toBe(403);
});

test('answers no host it was not given', async () => {
  await expect(connect(consoleSite, 'unknown.localhost')).rejects.toThrow();
  await expect(
    call(consoleSite, head({ host: 'unknown.localhost', port: consoleSite.port }, 'GET', '/')),
  ).rejects.toThrow(/No answer/);
  await expect(
    exchange(
      await connectPlain(),
      head({ host: 'unknown.localhost', port: plainPort }, 'GET', '/'),
    ),
  ).rejects.toThrow(/No answer/);

  const redirect = await exchange(
    await connectPlain(),
    head({ host: consoleSite.host, port: plainPort }, 'GET', '/sign-in?x=1'),
  );
  expect(redirect.status).toBe(308);
  expect(redirect.headers.get('location')).toBe(
    `https://${consoleSite.host}:${String(consoleSite.port)}/sign-in?x=1`,
  );
});

for (const site of [consoleSite, portalSite]) {
  test(`passes ${site.host}'s index.html through with a fresh nonce each time`, async () => {
    const first = await call(site, head(site, 'GET', '/'), true);
    const second = await call(site, head(site, 'GET', '/'), true);

    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(first.body).toContain(nonceOf(first));
    expect(second.body).toContain(nonceOf(second));
  });
}

test('limits uploads by the connecting address, whatever forwarding headers say', async () => {
  test.setTimeout(UPLOAD_REFILL_MS + 30_000);
  try {
    let limited: Answer | undefined;
    // One upload, a burst of 10, then the next is refused; earlier tests spent a few.
    for (let sent = 0; sent < 12 && limited === undefined; sent += 1) {
      const spoofed = `203.0.113.${String(sent + 1)}`;
      const answer = await call(
        consoleSite,
        head(consoleSite, 'POST', '/api/grants/applications/x/files', {
          'content-length': '0',
          'x-forwarded-for': spoofed,
          'x-real-ip': spoofed,
          forwarded: `for=${spoofed}`,
          'x-forwarded-host': portalSite.host,
        }),
      );
      if (answer.status === 429) limited = answer;
      else expect(answer.status).toBe(401);
    }
    expect(limited?.headers.get('retry-after')).toBe('2');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_REFILL_MS));
  }
});
