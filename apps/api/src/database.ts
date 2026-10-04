// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API's one database connection pool, as the `app_api` role, through the
// client in packages/db. Only packages/db imports a database driver.

import { createDatabase, withTenant, type TenantId } from '@pixel-scientists/db';
import type { FastifyBaseLogger } from 'fastify';

import type { Config } from './config.ts';

/**
 * The transaction a request runs in, with its tenant set. A module types it to
 * its own schema with `tx.$extendTables<...>()` (ADR 0016).
 */
export type TenantTransaction = Parameters<Parameters<typeof withTenant<unknown, unknown>>[2]>[0];

/** Runs `work` in one transaction for `tenant`, which commits if `work` resolves. */
export type InTenant = <T>(
  tenant: TenantId,
  work: (tx: TenantTransaction) => Promise<T>,
) => Promise<T>;

export interface ApiDatabase {
  /** Resolves if the database answers a trivial query, and rejects if it does not. */
  check(): Promise<void>;
  inTenant: InTenant;
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
    applicationName: 'tps-api',
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
    inTenant: (tenant, work) => withTenant(db, tenant, work),
    close: () => db.destroy(),
  };
}
