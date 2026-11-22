// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which database the seed may write to, and the password it gives every
// account. The seed runs only in development (ADR 0005): TPS_DEV=1, a
// server on this machine, and a database named in this worktree's
// TPS_DEV_DATABASES, so a proxy on 127.0.0.1 to any other database,
// staging's included, is refused. Once connected, it must be migrator, and
// the database must never have held a tenant.

import { passwordSchema } from '@pixel-scientists/domain/auth';
import type pg from 'pg';

import {
  isLoopbackHost,
  readDatabaseName,
  readSecret,
  readServerConnection,
  readSetting,
  type Env,
  type ServerConnection,
} from '../scripts/settings.ts';

export interface Target {
  readonly database: string;
  readonly server: ServerConnection;
}

/** The database to seed, once every check that needs no connection has passed. */
export function checkTarget(env: Env): Target {
  const database = readDatabaseName(env, 'TPS_DB_NAME');
  if (env['TPS_DEV'] !== '1') {
    throw new Error(`Refusing to seed ${database}: the seed runs only in development (TPS_DEV=1).`);
  }
  const host = readSetting(env, 'TPS_DB_HOST');
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing to seed a database on ${host}: the seed runs only against a server on this machine.`,
    );
  }
  const own = (env['TPS_DEV_DATABASES'] ?? '').split(',').filter(Boolean);
  if (!own.includes(database)) {
    throw new Error(
      `Refusing to seed ${database}: it is not this worktree's development or stack database.`,
    );
  }
  if (database.endsWith('_test')) {
    throw new Error(`Refusing to seed ${database}: it is a test database.`);
  }
  return { database, server: readServerConnection(env) };
}

/** The seed password, which must be one the API would accept (ADR 0010). Never part of a message. */
export function readSeedPassword(env: Env): string {
  const password = readSecret(env, 'TPS_SEED_PASSWORD');
  if (!passwordSchema.safeParse(password).success) {
    throw new Error('The seed password must be 12 to 256 characters.');
  }
  return password;
}

/**
 * The checks that need the connection: it is migrator's, to a database that
 * has never stored a tenant. Forced row-level security hides every tenant
 * from migrator, so this asks whether the tenant table has ever stored a
 * row: a newly migrated one has no pages.
 */
export async function checkConnection(client: pg.ClientBase, database: string): Promise<void> {
  const { rows } = await client.query<{ migrator: boolean; used: boolean }>(
    `SELECT session_user = 'migrator' AND current_user = 'migrator' AS migrator,
            pg_catalog.pg_relation_size('app.tenant') > 0 AS used`,
  );
  const [{ migrator, used } = { migrator: false, used: true }] = rows;
  if (!migrator) throw new Error(`Refusing to seed ${database}: connect as migrator.`);
  if (used) {
    throw new Error(
      `Refusing to seed ${database}: it already has tenants. Seed an empty database: ` +
        'pnpm db:drop && pnpm db:migrate, or pnpm stack down --volumes && pnpm stack.',
    );
  }
}
