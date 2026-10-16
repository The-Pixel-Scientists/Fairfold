// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth plugin in the built app, with no database: requests here carry no
// session cookie, so nothing connects. Hosts, origins, bodies, CORS, and the
// rule that no Better Auth endpoint answers.

import { connect } from 'node:net';

import { authRoutes } from '@pixel-scientists/domain/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { ConfigError, Secret } from '../config.ts';
import { createLogger } from '../logger.ts';
import { newToken } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';

const CONSOLE = 'https://console.example.org';
const PORTAL = 'https://apply.example.org';

const env = {
  TPS_AUTH_SECRET: newToken(),
  TPS_DB_APP_AUTH_PASSWORD: 'a-long-enough-password',
  TPS_CONSOLE_ORIGIN: CONSOLE,
  TPS_PORTAL_ORIGIN: PORTAL,
};

/** A database that is never reached. */
const database = {
  host: '127.0.0.1',
  port: 9,
  database: 'tps_unused',
  password: new Secret('x'.repeat(16)),
};

const opened: { app: FastifyInstance; auth: Auth }[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const { app, auth } of opened.splice(0)) {
    await app.close();
    await auth.close();
  }
});

async function start(options: { trustProxy?: string[]; settings?: Record<string, string> } = {}) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', destination: logs.stream });
  const auth = createAuth(loadAuthSettings(options.settings ?? env), { database, log: logger });
  const app = await buildApp({
    logger,
    checkDatabase: () => Promise.resolve(),
    auth,
    ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
  });
  opened.push({ app, auth });
  return { app, auth, logs };
}

const signOut = (
  headers: Record<string, string>,
  extra: { remoteAddress?: string; payload?: string; url?: string } = {},
) => ({ method: 'POST', url: '/api/auth/sign-out', headers, ...extra }) as const;

/** The status code of one request written to the listening app as raw HTTP. */
async function rawStatus(app: FastifyInstance, request: string): Promise<number> {
  if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('Not listening on TCP.');
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(address.port, '127.0.0.1', () => socket.end(request));
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('end', () => {
      resolve(text);
    });
    socket.on('error', reject);
  });
  return Number(/^HTTP\/1\.1 (\d{3}) /.exec(response)?.[1]);
}

describe('hosts', () => {
  it('answers 404 to a host that is not configured, and still serves the probes', async () => {
    const { app } = await start();
    const unknown = await app.inject({
      url: '/api/auth/session',
      headers: { host: 'evil.example' },
    });
    expect(unknown.statusCode).toBe(404);
    for (const url of ['/health', '/health/ready']) {
      const probe = await app.inject({ url, headers: { host: 'evil.example' } });
      expect(probe.statusCode, url).toBe(200);
    }
    const document = await app.inject({ url: '/openapi.json', headers: { host: 'evil.example' } });
    expect(document.statusCode).not.toBe(404);
  });

  it('resolves a host however its case, trailing dot and port are written', async () => {
    const { app } = await start();
    for (const host of [
      'CONSOLE.example.org',
      'console.example.org.',
      'console.example.org:8443',
    ]) {
      const response = await app.inject(signOut({ host, origin: CONSOLE }));
      // Through the guard to the route, which wants a session.
      expect(response.statusCode, host).toBe(401);
    }
  });

  it('ignores X-Forwarded-Host from an address that is not a trusted proxy', async () => {
    const { app } = await start({ trustProxy: ['10.0.0.1'] });
    const spoofed = await app.inject(
      signOut({
        host: 'apply.example.org',
        'x-forwarded-host': 'console.example.org',
        origin: CONSOLE,
      }),
    );
    // Still the portal, so the console's origin is refused.
    expect(spoofed.statusCode).toBe(403);
  });

  it('believes X-Forwarded-Host from a trusted proxy', async () => {
    const { app } = await start({ trustProxy: ['127.0.0.1'] });
    const forwarded = await app.inject(
      signOut({
        host: 'internal:3000',
        'x-forwarded-host': 'console.example.org',
        origin: CONSOLE,
      }),
    );
    expect(forwarded.statusCode).toBe(401);
    const untrusted = await app.inject(
      signOut(
        { host: 'internal:3000', 'x-forwarded-host': 'console.example.org', origin: CONSOLE },
        { remoteAddress: '203.0.113.9' },
      ),
    );
    expect(untrusted.statusCode).toBe(404);
  });

  it('logs a warning at start-up when both apps share one host', async () => {
    const { logs } = await start({
      settings: {
        ...env,
        TPS_CONSOLE_ORIGIN: 'https://grants.example.org',
        TPS_PORTAL_ORIGIN: 'https://grants.example.org',
        TPS_CONSOLE_PATH_PREFIX: '/console',
      },
    });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: expect.stringContaining('share one host') as unknown,
      }),
    );
  });
});

describe('request logs', () => {
  it('hold no cookie, token or client address', async () => {
    const { app, logs } = await start();
    const token = newToken();
    await app.inject({
      url: '/api/auth/session',
      headers: { host: 'console.example.org', cookie: `__Host-tps_portal_session=${token}` },
      remoteAddress: '203.0.113.9',
    });
    expect(logs.lines().length).toBeGreaterThan(0);
    for (const secret of [token, 'tps_portal_session', '203.0.113.9', env.TPS_AUTH_SECRET]) {
      expect(logs.text()).not.toContain(secret);
    }
  });
});

describe('the request guard', () => {
  it('refuses a portal-origin POST to a console host, and one with no origin', async () => {
    const { app } = await start();
    const portal = await app.inject(signOut({ host: 'console.example.org', origin: PORTAL }));
    expect(portal.statusCode).toBe(403);
    const none = await app.inject(signOut({ host: 'console.example.org' }));
    expect(none.statusCode).toBe(403);
    const own = await app.inject(signOut({ host: 'apply.example.org', origin: PORTAL }));
    expect(own.statusCode).toBe(401);
  });

  it('guards a path the router decodes, however it is escaped', async () => {
    const { app } = await start();
    const foreign = { host: 'console.example.org', origin: 'https://evil.example' };
    for (const url of [
      '/%61pi/auth/sign-out',
      '/%61%70%69/auth/sign-out',
      '/api/auth/sign%2Dout',
    ]) {
      const refused = await app.inject(
        signOut({ ...foreign, 'content-type': 'text/plain' }, { url, payload: 'a=1' }),
      );
      expect(refused.statusCode, url).toBe(403);
      const unknown = await app.inject(signOut({ host: 'evil.example' }, { url }));
      expect(unknown.statusCode, url).toBe(404);
    }
  });

  it('guards an absolute-form request target', async () => {
    const { app } = await start();
    const request = (host: string) =>
      [
        'POST http://console.example.org/api/auth/sign-out HTTP/1.1',
        `Host: ${host}`,
        'Origin: https://evil.example',
        'Content-Type: text/plain',
        'Content-Length: 3',
        'Connection: close',
        '',
        'a=1',
      ].join('\r\n');
    expect(await rawStatus(app, request('console.example.org'))).toBe(403);
    expect(await rawStatus(app, request('evil.example'))).toBe(404);
  });

  it('guards an escaped path under the console prefix on a single host', async () => {
    const origin = 'https://grants.example.org';
    const { app } = await start({
      settings: {
        ...env,
        TPS_CONSOLE_ORIGIN: origin,
        TPS_PORTAL_ORIGIN: origin,
        TPS_CONSOLE_PATH_PREFIX: '/console',
      },
    });
    const url = '/console/%61pi/auth/sign-out';
    const foreign = await app.inject(
      signOut({ host: 'grants.example.org', origin: 'https://evil.example' }, { url }),
    );
    expect(foreign.statusCode).toBe(403);
  });

  it('refuses a body that is not JSON', async () => {
    const { app } = await start();
    const headers = { host: 'console.example.org', origin: CONSOLE };
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const response = await app.inject(
        signOut({ ...headers, 'content-type': type }, { payload: 'a=1' }),
      );
      expect(response.statusCode, type).toBe(415);
    }
    const untyped = await app.inject({ ...signOut(headers), payload: Buffer.from('{}') });
    expect(untyped.statusCode).toBe(415);
  });

  it('sends no CORS header, even to a preflight from another origin', async () => {
    const { app } = await start();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/session',
      headers: {
        host: 'console.example.org',
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.statusCode).toBe(403);
    expect(
      Object.keys(preflight.headers).filter((name) => name.startsWith('access-control-')),
    ).toEqual([]);
  });
});

describe('Better Auth', () => {
  it('refuses to start while a variable it reads would override our settings', () => {
    for (const name of [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_SECRETS',
      'AUTH_SECRET',
      'BETTER_AUTH_URL',
      'AUTH_URL',
      'BASE_URL',
      'NUXT_PUBLIC_AUTH_URL',
      'NEXT_PUBLIC_BETTER_AUTH_URL',
      'BETTER_AUTH_TRUSTED_ORIGINS',
      'BETTER_AUTH_TELEMETRY',
      'BETTER_AUTH_TELEMETRY_ENDPOINT',
      'BETTER_AUTH_TELEMETRY_ID',
    ]) {
      vi.stubEnv(
        name,
        name.includes('URL') || name.includes('ORIGIN') ? 'https://evil.example' : '1',
      );
      let problems: readonly string[] = [];
      try {
        const log = createLogger({ level: 'info', destination: captureLogs().stream });
        createAuth(loadAuthSettings(env), { database, log });
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        problems = error.problems;
      }
      expect(problems, name).toEqual([`Unset ${name}: the API configures Better Auth itself.`]);
      vi.unstubAllEnvs();
    }
  });

  it('answers on none of its endpoints; only our contract routes answer', async () => {
    const { app, auth } = await start();
    const ours = new Set(Object.values(authRoutes).map((r) => `${r.method} /api${r.path}`));
    const answered: string[] = [];
    for (const endpoint of Object.values(auth.betterAuth.api) as {
      path?: string;
      options?: { method?: string | string[] };
    }[]) {
      if (endpoint.path === undefined) continue;
      const url = `/api/auth${endpoint.path.replaceAll(/:[a-z]+/gi, 'x')}`;
      for (const method of [endpoint.options?.method ?? 'GET'].flat()) {
        const response = await app.inject({
          method: method as 'GET' | 'POST',
          url,
          headers: {
            host: 'console.example.org',
            origin: CONSOLE,
            'content-type': 'application/json',
          },
          ...(method === 'GET' ? {} : { payload: '{}' }),
        });
        if (response.statusCode !== 404 && !ours.has(`${method} ${url}`)) {
          answered.push(`${method} ${url} ${String(response.statusCode)}`);
        }
      }
    }
    expect(answered).toEqual([]);
  });

  it('is configured to ADR 0010', async () => {
    const { auth } = await start();
    const { options } = auth.betterAuth;
    expect(options).toMatchObject({
      basePath: '/api/auth',
      trustedOrigins: [CONSOLE, PORTAL],
      telemetry: { enabled: false },
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        requireEmailVerification: true,
        autoSignIn: false,
      },
      emailVerification: { autoSignInAfterVerification: false },
      session: { cookieCache: { enabled: false } },
      account: { accountLinking: { enabled: false } },
      verification: { storeIdentifier: 'hashed' },
      advanced: { useSecureCookies: true, ipAddress: { ipAddressHeaders: ['x-tps-client-ip'] } },
    });
    expect(options.plugins.map((plugin) => plugin.id)).toEqual(['two-factor']);
  });
});
