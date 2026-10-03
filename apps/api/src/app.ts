// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the application: the server (server.ts), the OpenAPI document and
// the routes. It takes everything it depends on as arguments, so tests can
// build it with a fake database check and no network.

import swagger from '@fastify/swagger';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

import manifest from '../package.json' with { type: 'json' };
import { createReadinessCheck, healthRoutes } from './routes/health.ts';
import { openApiRoutes } from './routes/openapi.ts';
import { createServer } from './server.ts';

export interface AppOptions {
  logger: FastifyBaseLogger;
  /** Resolves if the database answers, and rejects if it does not. */
  checkDatabase: () => Promise<void>;
  /** How long `/health/ready` waits for the database. Defaults to 2 seconds. */
  readinessTimeoutMs?: number;
}

const DEFAULT_READINESS_TIMEOUT_MS = 2000;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = createServer(options.logger);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'PixelGrant API',
        description: 'The PixelGrant grants management API.',
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

  return app;
}
