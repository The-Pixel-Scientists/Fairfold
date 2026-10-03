// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API's one database connection pool, as the `app_api` role, through the
// client in packages/db. Only packages/db imports a database driver.

import { createDatabase } from '@pixelgrant/db';
import type { FastifyBaseLogger } from 'fastify';

import type { Config } from './config.ts';

export interface ApiDatabase {
  /** Resolves if the database answers a trivial query, and rejects if it does not. */
  check(): Promise<void>;
  /** Closes the pool. */
  close(): Promise<void>;
}

export function openDatabase(settings: Config['database'], log: FastifyBaseLogger): ApiDatabase {
  const db = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password.reveal(),
    applicationName: 'pixelgrant-api',
    tls: settings.tls,
    // Problems that no request is waiting for, such as an idle connection that fails.
    log: (message, error) => {
      log.error({ err: error }, message);
    },
  });
  return {
    async check() {
      // No tenant is set: the readiness probe reads no tenant data.
      await db.selectNoFrom((eb) => eb.lit(1).as('ok')).execute();
    },
    close: () => db.destroy(),
  };
}
