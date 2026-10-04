// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the application: the server (server.ts), the OpenAPI document and
// the routes. It takes everything it depends on as arguments, so tests can
// build it with a fake database check and no network.
//
// The probes and the OpenAPI document are at the root. Every route with a
// contract is served under apiBasePath, as the apps call it (ADR 0004).

import { apiBasePath } from '@pixel-scientists/domain/api';
import swagger from '@fastify/swagger';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { suiteName } from '@pixel-scientists/domain/platform';

import manifest from '../package.json' with { type: 'json' };
import type { AuthModule } from './context.ts';
import type { InTenant } from './database.ts';
import { withTenantScope, type ScopeResolvers } from './policy/index.ts';
import { createReadinessCheck, healthRoutes } from './routes/health.ts';
import { openApiRoutes } from './routes/openapi.ts';
import { isRegisteredFromContract, registerRoutes, type Route } from './routes/register.ts';
import { createServer } from './server.ts';

export interface AppOptions {
  logger: FastifyBaseLogger;
  /** Resolves if the database answers, and rejects if it does not. */
  checkDatabase: () => Promise<void>;
  /** How long `/health/ready` waits for the database. Defaults to 2 seconds. */
  readinessTimeoutMs?: number;
  /** Runs a request's work in one transaction for its tenant. Console and portal routes need it. */
  inTenant?: InTenant;
  /** Reads sessions and serves the auth routes (S02-07). Without it, nobody is signed in. */
  auth?: AuthModule;
  /** The routes of every module, from their contracts. */
  routes?: readonly Route[];
  /** Each module's scope rule resolvers, by rule id. The platform adds `tenant`. */
  resolvers?: ScopeResolvers;
  /** Addresses or ranges of the reverse proxies to trust. None by default. */
  trustProxy?: readonly string[];
}

const noDatabase: InTenant = () =>
  Promise.reject(new Error('The API was built without a database.'));

const signedOut: AuthModule['readSession'] = () => Promise.resolve({ app: null, session: null });

const DEFAULT_READINESS_TIMEOUT_MS = 2000;

/** The only routes without a contract, so without a permission or a scope rule (Fastify adds each HEAD). */
const ROUTES_WITHOUT_CONTRACT: ReadonlySet<string> = new Set(
  ['/health', '/health/ready', '/openapi.json'].flatMap((url) => [`GET ${url}`, `HEAD ${url}`]),
);

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = createServer(options.logger, { trustProxy: options.trustProxy ?? [] });

  // Every other route is registered from a contract, which the policy enforces.
  app.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    const allowed = methods.every((method) =>
      ROUTES_WITHOUT_CONTRACT.has(`${method} ${route.url}`),
    );
    if (!allowed && !isRegisteredFromContract(route)) {
      throw new Error(`${methods.join(', ')} ${route.url} has no route contract.`);
    }
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${suiteName} API`,
        description: `The ${suiteName} grants management API.`,
        version: manifest.version,
        license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
      },
      tags: [{ name: 'Health', description: 'Probes for the platform that runs the API.' }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(healthRoutes, {
    checkReadiness: createReadinessCheck(
      options.checkDatabase,
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    ),
  });
  await app.register(openApiRoutes);

  if (options.auth !== undefined) await app.register(options.auth.plugin);
  const deps = {
    readSession: options.auth?.readSession.bind(options.auth) ?? signedOut,
    inTenant: options.inTenant ?? noDatabase,
    resolvers: withTenantScope(options.resolvers ?? {}),
  };
  // Registering inside a plugin applies the prefix.
  await app.register(
    (scope) =>
      // A route that cannot be served rejects here, which stops start-up.
      new Promise<void>((resolve) => {
        registerRoutes(scope, options.routes ?? [], deps);
        resolve();
      }),
    { prefix: apiBasePath },
  );

  return app;
}
