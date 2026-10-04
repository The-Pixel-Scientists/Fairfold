// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Route registration, and the policy's steps that need no database: what
// comes before the tenant transaction. A request that reaches the database
// is told apart by a transaction that answers 409. The steps that read
// memberships and module switches are in test/policy.integration.test.ts.

import { defineRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { authRoutes } from '@pixel-scientists/domain/auth';
import { permissions, type ModuleId, type Permission } from '@pixel-scientists/domain/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureLogs, testAuth, testSession } from '../../test/support.ts';
import { buildApp, type AppOptions } from '../app.ts';
import type { SessionRead } from '../context.ts';
import type { InTenant } from '../database.ts';
import { createLogger } from '../logger.ts';
import type { ScopeResolvers } from '../policy/index.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from './register.ts';

// Building the application loads Fastify and its plugins, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

const everyScope: ScopeResolvers = {
  assigned_review: () => Promise.resolve(true),
  own_person: () => Promise.resolve(true),
  own_organisation: () => Promise.resolve(true),
  own_application: () => Promise.resolve(true),
};

/** Reaching the database is how a test sees that the policy let a request through. */
const PASSED = 409;

function newTransaction() {
  let calls = 0;
  const inTenant: InTenant = () => {
    calls += 1;
    return Promise.reject(new ApiError(PASSED, 'The policy let it through.'));
  };
  return { inTenant, calls: () => calls, reset: () => (calls = 0) };
}

async function build(options: Partial<AppOptions> = {}, logs = captureLogs()) {
  const transaction = newTransaction();
  const auth = testAuth();
  const app = await buildApp({
    logger: createLogger({ level: 'info', destination: logs.stream }),
    checkDatabase: () => Promise.resolve(),
    inTenant: transaction.inTenant,
    auth: auth.module,
    resolvers: everyScope,
    ...options,
  });
  return { app, auth, transaction, logs };
}

const pong = z.object({ ok: z.boolean() });

const ping = defineRoute({
  method: 'GET',
  path: '/public/ping',
  audience: 'public',
  module: 'platform',
  permission: null,
  scope: null,
  summary: 'Ping',
  responses: { 200: pong },
});

const settings = defineRoute({
  method: 'GET',
  path: '/console/settings',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Read the settings',
  responses: { 200: pong },
});

const ok = () => Promise.resolve({ ok: true });

describe('registered routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('are served under the API base path, with the probes and the document at the root', async () => {
    ({ app } = await build({ routes: [route(ping, ok)] }));

    expect((await app.inject({ url: '/api/public/ping' })).json()).toEqual({ ok: true });
    expect((await app.inject({ url: '/public/ping' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/openapi.json' })).statusCode).toBe(200);
  });

  it('drop response fields the contract does not declare', async () => {
    const leaky = { ok: true, internalNote: 'do not send', applicantEmail: 'jo@example.org' };
    ({ app } = await build({ routes: [route(ping, () => Promise.resolve(leaky))] }));

    const response = await app.inject({ url: '/api/public/ping' });

    expect(response.json()).toEqual({ ok: true });
    expect(response.body).not.toContain('internalNote');
  });

  it('answer a contract without a body with no body', async () => {
    const auth = testAuth();
    ({ app } = await build({
      auth: auth.module,
      routes: [route(authRoutes.signOut, () => Promise.resolve(undefined))],
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: auth.as({ app: 'console', session: testSession() }),
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('refuse a route registered without a contract', async () => {
    await expect(
      build({
        auth: {
          ...testAuth().module,
          plugin: (scope) =>
            new Promise<void>((resolve) => {
              scope.get('/rogue', () => ({ secret: true }));
              resolve();
            }),
        },
      }),
    ).rejects.toThrow(/GET \/rogue has no route contract/);
  });

  it('refuse a route registered by method and path outside the probes', async () => {
    const plugin = (register: (scope: FastifyInstance) => void) => ({
      ...testAuth().module,
      plugin: (scope: FastifyInstance) =>
        new Promise<void>((resolve) => {
          register(scope);
          resolve();
        }),
    });

    await expect(
      build({ auth: plugin((scope) => scope.post('/health', () => ({ ok: true }))) }),
    ).rejects.toThrow(/POST \/health has no route contract/);
    await expect(
      build({
        auth: plugin((scope) =>
          scope.route({
            method: 'GET',
            url: '/rogue',
            config: { contract: {} },
            handler: () => ({ secret: true }),
          }),
        ),
      }),
    ).rejects.toThrow(/GET \/rogue has no route contract/);
  });

  describe('take only the request parts their contract declares', () => {
    const seen: unknown[] = [];
    const record = (input: unknown) => {
      seen.push(input);
      return Promise.resolve({ ok: true });
    };
    const bare = (method: 'GET' | 'POST' | 'DELETE', path: string) =>
      defineRoute({
        method,
        path,
        audience: 'public',
        module: 'platform',
        permission: null,
        scope: null,
        summary: 'Bare',
        responses: { 200: pong },
      });
    const routes = [
      route(bare('GET', '/public/bare'), ({ input }) => record(input)),
      route(bare('POST', '/public/bare'), ({ input }) => record(input)),
      route(bare('DELETE', '/public/bare'), ({ input }) => record(input)),
    ];

    it('refuses a query key, and a body on a POST or a DELETE, 400', async () => {
      ({ app } = await build({ routes }));
      const secrets = '?tenantId=x&userId=y';

      const query = await app.inject({ url: `/api/public/bare${secrets}` });
      const post = await app.inject({
        method: 'POST',
        url: '/api/public/bare',
        payload: { evil: 1 },
      });
      const remove = await app.inject({
        method: 'DELETE',
        url: '/api/public/bare',
        payload: { evil: 1 },
      });

      expect([query.statusCode, post.statusCode, remove.statusCode]).toEqual([400, 400, 400]);
      expect(seen).toEqual([]);
    });

    it('hands the handler no part it did not declare', async () => {
      ({ app } = await build({ routes }));

      await app.inject({ url: '/api/public/bare' });
      await app.inject({ method: 'POST', url: '/api/public/bare' });
      await app.inject({ method: 'DELETE', url: '/api/public/bare' });

      expect(seen.slice(-3)).toEqual([{}, {}, {}]);
    });
  });

  it('carry the security headers, errors and unknown routes included', async () => {
    ({ app } = await build({ routes: [route(ping, ok)] }));

    for (const url of ['/health', '/api/public/ping', '/api/nothing-here', '/%']) {
      const { headers } = await app.inject({ url });
      expect(headers, url).toMatchObject({
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'cross-origin-opener-policy': 'same-origin',
        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
        'referrer-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      });
      expect(headers['x-request-id'], url).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers['strict-transport-security'], url).toBeUndefined();
    }
  });

  it('add HSTS only over HTTPS as a trusted proxy reports it', async () => {
    ({ app } = await build({ trustProxy: ['10.0.0.0/8'] }));
    const secure = { 'x-forwarded-proto': 'https' };

    const trusted = await app.inject({
      url: '/health',
      remoteAddress: '10.1.2.3',
      headers: secure,
    });
    const stranger = await app.inject({
      url: '/health',
      remoteAddress: '203.0.113.9',
      headers: secure,
    });

    expect(trusted.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(stranger.headers['strict-transport-security']).toBeUndefined();
  });

  it('refuse a body over the limit, in words', async () => {
    ({ app } = await build({
      routes: [route(authRoutes.completeSignUp, () => Promise.resolve(undefined))],
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/complete',
      payload: { token: 'x'.repeat(1_100_000), password: 'y' },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json<{ detail: string }>().detail).toBe('The request body is too large.');
  });

  it('document the problems a caller can get, with the domain problem schema', async () => {
    ({ app } = await build({
      routes: [route(ping, ok), route(settings, ok)],
    }));
    type Operation = { responses: Record<string, { content?: Record<string, unknown> }> };
    const { paths } = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, { get: Operation }>;
    }>();

    const problemsOf = (path: string) =>
      Object.keys(paths[path]?.get.responses ?? {})
        .filter((status) => status !== '200')
        .sort();
    expect(problemsOf('/api/public/ping')).toEqual(['400', '404']);
    expect(problemsOf('/api/console/settings')).toEqual(['400', '401', '403', '404']);
    expect(
      paths['/api/console/settings']?.get.responses['403']?.content?.['application/problem+json'],
    ).toMatchObject({
      schema: { properties: { requestId: { type: 'string' }, errors: { type: 'array' } } },
    });
  });
});

describe('start-up', () => {
  const orphan = defineRoute({
    method: 'GET',
    path: '/console/reviews/:reviewId',
    audience: 'console',
    module: 'grants',
    permission: 'grants.reviews.score',
    scope: 'assigned_review',
    summary: 'Read a review',
    params: z.strictObject({ reviewId: z.uuid() }),
    responses: { 200: pong },
  });
  const quiet = {
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(),
  };

  it('stops for a route whose scope rule no module resolves', async () => {
    await expect(buildApp({ ...quiet, routes: [route(orphan, ok)] })).rejects.toThrow(
      /GET \/console\/reviews\/:reviewId[\s\S]*assigned_review/,
    );
  });

  it('stops for a module that registers the platform tenant scope rule', async () => {
    await expect(
      buildApp({ ...quiet, resolvers: { tenant: () => Promise.resolve(true) } }),
    ).rejects.toThrow(/tenant scope rule/);
  });

  it('stops for a contract built without defineRoute()', async () => {
    const forged = {
      ...settings,
      permission: 'grants.decisions.release',
      scope: 'own_person',
    } as unknown as RouteContract;

    await expect(buildApp({ ...quiet, routes: [route(forged, ok as never)] })).rejects.toThrow(
      /GET \/console\/settings cannot be registered/,
    );
  });

  it('stops for a route with more than one success response', async () => {
    const two = { ...ping, responses: { 200: pong, 201: pong } } as unknown as RouteContract;

    await expect(buildApp({ ...quiet, routes: [route(two, ok as never)] })).rejects.toThrow(
      /exactly one success response/,
    );
  });
});

/** One POST route for every permission, with the scope and step-up its contract allows. */
function permissionRoute(permission: Permission): RouteContract {
  const granted = permissions[permission];
  return defineRoute({
    method: 'POST',
    path: `/${granted.app}/probes/${permission.replaceAll('.', '-')}`,
    audience: granted.app,
    module: permission.split('.')[0] as ModuleId,
    permission,
    scope: granted.scopes[0],
    ...('stepUp' in granted ? { stepUp: true } : {}),
    summary: 'Probe',
    body: z.strictObject({}),
    responses: { 204: null },
  } as never);
}

const permissionRoutes = (Object.keys(permissions) as Permission[]).map(permissionRoute);
const authContracts = Object.values(authRoutes);

/** One app with a route for every permission and every auth route, for the walks below. */
describe('the policy before the transaction', () => {
  let app: FastifyInstance;
  let auth: ReturnType<typeof testAuth>;
  let transaction: ReturnType<typeof newTransaction>;

  beforeAll(async () => {
    const routes: Route[] = [
      ...permissionRoutes.map((contract) =>
        route(contract, () => Promise.resolve(undefined) as never),
      ),
      ...authContracts.map((contract) =>
        route(contract, () => Promise.reject(new ApiError(PASSED)) as never),
      ),
    ];
    ({ app, auth, transaction } = await build({ routes }));
  });
  afterAll(async () => {
    await app.close();
  });

  /** The status of a request to a contract, with a session read or none. */
  async function status(contract: RouteContract, read?: SessionRead): Promise<number> {
    const url = `/api${contract.path.replace(':slug', 'northfield')}`;
    const response = await app.inject({
      method: contract.method,
      url,
      payload: contract.method === 'GET' ? undefined : {},
      headers: read === undefined ? {} : auth.as(read),
    });
    return response.statusCode;
  }

  /** Reached the route's own validation or handler, whatever they then said. */
  const passed = (code: number) => code !== 401 && code !== 403;

  const staff = (options = {}) => ({ app: 'console', session: testSession(options) }) as const;
  const applicant = (options = {}) =>
    ({ app: 'portal', session: testSession({ app: 'portal', ...options }) }) as const;

  const memberRoutes = permissionRoutes.filter(
    (contract) => contract.audience === 'console' || contract.audience === 'portal',
  );

  it('walks a route for every permission', () => {
    expect(permissionRoutes).toHaveLength(Object.keys(permissions).length);
    expect(memberRoutes).toHaveLength(permissionRoutes.length);
  });

  it('refuses a request with no session, 401, before it opens a transaction', async () => {
    for (const contract of memberRoutes) expect(await status(contract), contract.path).toBe(401);
    expect(transaction.calls()).toBe(0);
  });

  it('refuses a session waiting for MFA, 401, on every route that needs a permission', async () => {
    for (const contract of memberRoutes) {
      for (const mfa of ['enrol', 'verify'] as const) {
        expect(await status(contract, staff({ mfa })), `${contract.path} ${mfa}`).toBe(401);
      }
    }
    expect(transaction.calls()).toBe(0);
  });

  it('does not take "no MFA needed" from a staff session', async () => {
    for (const contract of memberRoutes.filter((c) => c.audience === 'console')) {
      expect(await status(contract, staff({ mfa: 'not_required' })), contract.path).toBe(401);
    }
  });

  it('refuses a session of the other app, and a request for the other app, 403', async () => {
    for (const contract of memberRoutes) {
      const other = contract.audience === 'console' ? applicant() : staff();
      expect(await status(contract, other), contract.path).toBe(403);
      const mine = contract.audience === 'console' ? staff() : applicant();
      expect(await status(contract, { ...mine, app: other.app }), contract.path).toBe(403);
      expect(await status(contract, { ...mine, app: null }), contract.path).toBe(403);
    }
    expect(transaction.calls()).toBe(0);
  });

  it('lets a step-up route through only within 5 minutes of re-authentication', async () => {
    const stepUp = memberRoutes.filter((contract) => 'stepUp' in contract && contract.stepUp);
    expect(stepUp.map((contract) => contract.path)).toEqual([
      '/console/probes/platform-members-manage',
      '/console/probes/grants-decisions-release',
    ]);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    for (const contract of stepUp) {
      for (const recentAuthAt of [null, ago(5.5), ago(60), new Date(Date.now() + 60_000)]) {
        expect(await status(contract, staff({ recentAuthAt })), contract.path).toBe(403);
      }
      for (const recentAuthAt of [ago(0), ago(4.5)]) {
        expect(await status(contract, staff({ recentAuthAt })), contract.path).toBe(PASSED);
      }
    }
  });

  it('opens the transaction for a route without step-up whatever the last authentication', async () => {
    transaction.reset();
    const plain = memberRoutes.filter((contract) => !('stepUp' in contract));
    for (const contract of plain) {
      const read = contract.audience === 'console' ? staff() : applicant();
      expect(await status(contract, read), contract.path).toBe(PASSED);
    }
    expect(transaction.calls()).toBe(plain.length);
  });

  it('answers for each auth route as the session it needs', async () => {
    const sessions = {
      none: undefined,
      waiting: staff({ mfa: 'enrol' }),
      staff: staff(),
      applicant: applicant(),
    } as const;
    const allowed = {
      none: { none: true, waiting: true, staff: true, applicant: true },
      mfa_pending: { none: false, waiting: true, staff: false, applicant: false },
      any: { none: false, waiting: true, staff: true, applicant: true },
      complete: { none: false, waiting: false, staff: true, applicant: true },
    } as const;

    for (const contract of authContracts) {
      for (const [name, read] of Object.entries(sessions)) {
        const expected = allowed[contract.session][name as keyof typeof sessions];
        expect(passed(await status(contract, read)), `${contract.path} with ${name}`).toBe(
          expected,
        );
      }
    }
  });

  it('answers 401 to a session waiting for MFA on every route but the TOTP routes, sign-out and the session', async () => {
    const reached = [];
    for (const contract of [...authContracts, ...permissionRoutes]) {
      if (passed(await status(contract, staff({ mfa: 'verify' })))) reached.push(contract.path);
    }
    expect(reached.sort()).toEqual(
      [
        '/auth/sign-out',
        '/auth/session',
        '/auth/totp/confirm',
        '/auth/totp/enrol',
        '/auth/totp/verify',
        ...authContracts.filter((c) => c.session === 'none').map((c) => c.path),
      ].sort(),
    );
  });

  it('never hands a complete session to the TOTP routes', async () => {
    for (const contract of authContracts.filter((c) => c.session === 'mfa_pending')) {
      expect(await status(contract, staff()), contract.path).toBe(403);
    }
  });

  it('serves a public route with no session', async () => {
    const { app: server } = await build({ routes: [route(ping, ok)] });
    const response = await server.inject({ url: '/api/public/ping' });
    await server.close();
    expect(response.statusCode).toBe(200);
  });

  it('logs a refusal with its reason and nothing about the caller', async () => {
    const logs = captureLogs();
    const { app: server, auth: testing } = await build({ routes: [route(settings, ok)] }, logs);
    const response = await server.inject({
      url: '/api/console/settings',
      headers: testing.as(staff({ mfa: 'verify' })),
    });
    await server.close();

    expect(response.statusCode).toBe(401);
    expect(response.json<{ detail: string }>().detail).toBe('Sign in to continue.');
    expect(logs.lines().find((line) => line.msg === 'The request was refused')).toMatchObject({
      status: 401,
      reason: 'mfa_pending',
    });
  });
});
