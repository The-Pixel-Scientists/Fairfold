// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API's one database connection pool, as the `app_api` role, through the
// client in packages/db. Only packages/db imports a database driver.

import {
  createDatabase,
  publicTenant,
  publicTenantLogo,
  withTenant,
  type Kysely,
  type PublicTenantRow,
  type TenantId,
} from '@pixel-scientists/db';
import type { LogoType } from '@pixel-scientists/domain/platform';
import type { FastifyBaseLogger } from 'fastify';

import type { Config } from './config.ts';
import { counterStore, type CounterStore, type UploadCounters } from './limits/store.ts';

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

/**
 * An active tenant's public face and logo by slug, through ADR 0019's
 * functions. No tenant is set on the connection, and a suspended, unknown or
 * malformed slug gives nothing.
 */
export interface PublicTenants {
  tenant(slug: string): Promise<PublicTenantRow | undefined>;
  logo(slug: string): Promise<{ logo: Buffer; logoType: LogoType } | undefined>;
}

export function publicTenantsOn(db: Kysely<unknown>): PublicTenants {
  return { tenant: (slug) => publicTenant(db, slug), logo: (slug) => publicTenantLogo(db, slug) };
}

export interface ApiDatabase {
  /** Resolves if the database answers a trivial query, and rejects if it does not. */
  check(): Promise<void>;
  inTenant: InTenant;
  /** For routes that need no session. */
  publicTenants: PublicTenants;
  /** The request limits' counters, in no tenant (S11-36). */
  requestLimits: CounterStore & UploadCounters;
  /** Closes the pool. */
  close(): Promise<void>;
}

export function openDatabase(settings: Config['database'], log: FastifyBaseLogger): ApiDatabase {
  const password = settings.password.reveal();
  // Problems that no request is waiting for, such as an idle connection that fails.
  const logProblem = (message: string, error: Error) => {
    log.error({ err: error }, message);
  };
  const db = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password,
    tls: settings.tls,
    log: logProblem,
    applicationName: 'tps-api',
  });
  // The limits' counters get a small pool of their own, which gives up quickly, so
  // that a flood of requests being counted can never take the connections that tenant
  // transactions need (S11-36).
  const counters = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password,
    tls: settings.tls,
    log: logProblem,
    applicationName: 'tps-api-limits',
    maxConnections: 4,
    connectionTimeoutMillis: 500,
    statementTimeoutMillis: 2000,
    queryTimeoutMillis: 3000,
  });
  return {
    async check() {
      // No tenant is set: the readiness probe reads no tenant data.
      await db.selectNoFrom((eb) => eb.lit(1).as('ok')).execute();
    },
    inTenant: (tenant, work) => withTenant(db, tenant, work),
    publicTenants: publicTenantsOn(db),
    requestLimits: counterStore(counters),
    close: async () => {
      await Promise.all([db.destroy(), counters.destroy()]);
    },
  };
}
