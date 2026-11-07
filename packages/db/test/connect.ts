// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Connections to this worktree's test database for the db Vitest project.
// scripts/dev-env.ts supplies the settings (profile database-tests): the
// passwords of the app roles and migrator, never the superuser's.

import pg from 'pg';

import { readRolePassword, type LoginRole } from '../scripts/roles.ts';
import { readDatabaseName, readServer } from '../scripts/settings.ts';
import type { DatabaseSettings } from '../src/database.ts';

export const APP_ROLES = ['app_api', 'app_worker', 'app_auth', 'app_queue'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * The NOLOGIN app roles, each with the one login role that may SET ROLE to
 * it (ADR 0009): operator commands run as app_operator through app_worker.
 */
export const SET_ROLES = { app_operator: 'app_worker' } as const satisfies Record<
  string,
  LoginRole
>;
export type SetRole = keyof typeof SET_ROLES;

/** Every role whose rights the privilege lint and cross-tenant tests check. */
export const RIGHTS_ROLES: readonly (AppRole | SetRole)[] = [
  ...APP_ROLES,
  ...(Object.keys(SET_ROLES) as SetRole[]),
];

const env = process.env;

export function connectionSettings(role: LoginRole): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  return {
    ...readServer(env),
    database: readDatabaseName(env, 'TPS_TEST_DB_NAME'),
    user: role,
    password: readRolePassword(env, role),
  };
}

/** Settings for createDatabase(), connected as `role`. */
export function databaseSettings(
  role: DatabaseSettings['role'],
  maxConnections: number,
): DatabaseSettings {
  const { host, port, database, password } = connectionSettings(role);
  return {
    host,
    port,
    database,
    role,
    password,
    maxConnections,
    applicationName: 'tps-db-tests',
  };
}

/** Run `work` with a client connected as `role`, then close it. */
export async function withClient<T>(
  role: LoginRole,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client(connectionSettings(role));
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Run `work` with a client connected as `role`, or set to it if it cannot log in. */
export function withRoleClient<T>(
  role: LoginRole | SetRole,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  if (!(role in SET_ROLES)) return withClient(role as LoginRole, work);
  return withClient(SET_ROLES[role as SetRole], async (client) => {
    await client.query(`SET ROLE ${client.escapeIdentifier(role)}`);
    return work(client);
  });
}

/**
 * Run `work` as migrator inside a transaction that is always rolled back, so
 * fixtures such as scratch tables never reach the shared test database.
 */
export async function asMigratorRolledBack<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient('migrator', async (client) => {
    await client.query('BEGIN');
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}
