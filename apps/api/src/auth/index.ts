// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth module (ADR 0007, ADR 0010): the only code that reaches the auth
// schema, as app_auth, and the only code that imports Better Auth.
// createAuth() gives buildApp() its plugin and readSession(), and gives the
// rest of the API revokeSessions().
//
// The plugin adds one hook before every route, on every request, whatever
// its path (the router decodes percent-escapes, so a raw path is no guide):
//
//   - a request whose host is not configured gets 404, except a read of a
//     probe or the OpenAPI document;
//   - a request other than GET or HEAD needs `Origin` to be the resolved
//     app's own origin, and a body only as application/json.
//
// CORS stays off: no route or hook sends an Access-Control-* header.

import { createDatabase, type TenantId } from '@pixel-scientists/db';
import { apiBasePath } from '@pixel-scientists/domain/api';
import type { App } from '@pixel-scientists/domain/platform';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Config } from '../config.ts';
import type { AuthModule } from '../context.ts';
import { ApiError } from '../problems.ts';
import { registerRoutes } from '../routes/register.ts';
import { createBetterAuth, type BetterAuth } from './better-auth.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { appResolver } from './hosts.ts';
import { authRoutes } from './routes.ts';
import { revokeAll, sessionReader } from './sessions.ts';
import type { AuthSettings } from './settings.ts';

export { loadAuthSettings, type AuthSettings } from './settings.ts';
export { singleHostRewrite } from './hosts.ts';

export interface Auth extends AuthModule {
  /** Revoke a user's live sessions, or those active in one tenant, and record it. Returns how many. */
  revokeSessions(target: {
    readonly userId: string;
    readonly tenant?: TenantId;
    readonly requestId: string;
  }): Promise<number>;
  /** Better Auth's server API, for the auth routes still to come (S02-08, S02-09). */
  readonly betterAuth: BetterAuth;
  /** Closes the module's database pools. */
  close(): Promise<void>;
}

export interface AuthDependencies {
  /** Where the database is, and app_api's password (config.ts). */
  readonly database: Config['database'];
  readonly log: FastifyBaseLogger;
}

const READS = new Set(['GET', 'HEAD']);
const JSON_TYPE = /^application\/json\s*(?:;|$)/i;

/** Routes any host may read, by the pattern the router matched: the probes and OpenAPI. */
const ANY_HOST = new Set(['/health', '/health/ready', '/openapi.json']);

function hasBody(request: FastifyRequest): boolean {
  const length = request.headers['content-length'];
  return (
    (length !== undefined && length !== '0') || request.headers['transfer-encoding'] !== undefined
  );
}

export function createAuth(settings: AuthSettings, deps: AuthDependencies): Auth {
  const { host, port, database, tls } = deps.database;
  const connection = {
    host,
    port,
    database,
    ...(tls === undefined ? {} : { tls }),
    applicationName: 'tps-api-auth',
    maxConnections: 5,
    log: (message: string, error: Error) => {
      deps.log.error({ err: error }, message);
    },
    warn: (message: string) => {
      deps.log.warn(message);
    },
  };
  const api = createDatabase<unknown>({
    ...connection,
    role: 'app_api',
    password: deps.database.password.reveal(),
  });
  const auth = createDatabase<unknown>({
    ...connection,
    role: 'app_auth',
    password: settings.databasePassword.reveal(),
  });
  const betterAuth = createBetterAuth(settings, auth);

  const resolve = appResolver(settings);
  const resolveApp = (request: FastifyRequest): App | null =>
    resolve(request.host, request.originalUrl);
  const readSession = sessionReader({ api, auth, resolveApp });

  // Set-Cookie headers the routes asked for, by request id, until the response is sent.
  const cookies = new Map<string, string[]>();
  const routes = authRoutes({
    api,
    auth,
    log: deps.log,
    setCookie: (requestId, cookie) => {
      cookies.set(requestId, [...(cookies.get(requestId) ?? []), cookie]);
    },
  });

  if (settings.consolePathPrefix !== undefined) {
    deps.log.warn(
      'The console and portal share one host. A cross-site scripting bug in the portal could ' +
        'reach console routes. Give each app its own host name.',
    );
  }

  /** Why the guard refuses a request, or undefined to let it through. */
  const refusal = (request: FastifyRequest): ApiError | undefined => {
    const read = READS.has(request.method);
    if (read && ANY_HOST.has(request.routeOptions.url ?? '')) return undefined;
    const resolved = resolveApp(request);
    if (resolved === null) return new ApiError(404, undefined, { reason: 'unknown_host' });
    if (read) return undefined;
    if (request.headers.origin !== settings.origins[resolved]) {
      return new ApiError(403, undefined, { reason: 'origin' });
    }
    const type = request.headers['content-type'];
    if ((hasBody(request) || type !== undefined) && !JSON_TYPE.test(type ?? '')) {
      return new ApiError(415, undefined, { reason: 'not_json' });
    }
    return undefined;
  };

  const plugin: FastifyPluginAsync = async (app) => {
    app.addHook('onRequest', (request, _reply, done) => {
      done(refusal(request));
    });
    app.addHook('onSend', (request, reply, payload, done) => {
      const pending = cookies.get(request.id);
      if (pending !== undefined) {
        cookies.delete(request.id);
        void reply.header('set-cookie', pending);
      }
      done(null, payload);
    });
    app.addHook('onResponse', (request, _reply, done) => {
      cookies.delete(request.id);
      done();
    });
    await app.register(
      (scope, _options, done) => {
        registerRoutes(scope, routes, {
          readSession,
          inTenant: () => Promise.reject(new Error('Auth routes run with no tenant transaction.')),
          resolvers: {},
        });
        done();
      },
      { prefix: apiBasePath },
    );
  };
  // Its hooks apply to every route, not only those registered inside it.
  Object.assign(plugin, { [Symbol.for('skip-override')]: true });

  return {
    plugin,
    readSession,
    betterAuth,
    async revokeSessions({ userId, tenant, requestId }) {
      const { count, event } = await auth.transaction().execute(async (trx) => ({
        count: await revokeAll(trx, {
          userId,
          ...(tenant === undefined ? {} : { tenantId: tenant }),
        }),
        event: await recordAuthEvent(trx, 'sessions_revoked', {
          requestId,
          userId,
          ...(tenant === undefined ? {} : { tenant }),
        }),
      }));
      await copyAuthEvent({ api, auth, log: deps.log }, event);
      return count;
    },
    async close() {
      await Promise.all([api.destroy(), auth.destroy()]);
    },
  };
}
