// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Database commands. Run from the repository root:
//
//   node packages/db/scripts/db.ts <step>... [--test]
//
//   prepare  As the superuser: run roles.sql in the maintenance database,
//            create the database owned by migrator if it is missing (or
//            refuse one owned by anyone else), then run
//            database-privileges.sql in it. Install and upgrade procedures
//            run this before migrating.
//   up       As migrator: check the roles, then apply every pending migration.
//   down     As migrator: check the roles, then roll back the last migration.
//   status   As migrator, changing nothing: whether the connection uses TLS,
//            the roles' check, pending migrations and whether the worker is
//            connected. Exits 1 if any of them needs attention.
//   drop     As the superuser: drop this worktree's database. Development
//            only.
//
//   --test   Use TPS_TEST_DB_NAME instead of TPS_DB_NAME.
//
// Settings come from the environment (settings.ts). A server that is not on
// this machine needs TPS_DB_TLS, as the API does. In development,
// `pnpm db:migrate`, `pnpm db:rollback` and `pnpm db:drop` supply them.
// Test set-up can import the same steps.

import { readFileSync } from 'node:fs';

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import { createMigrator } from './migrations.ts';
import {
  applyDatabasePrivileges,
  applyRoles,
  assertRoles,
  findRoleProblems,
  LOGIN_ROLES,
  readAdminMode,
  readAdminRole,
  readRolePassword,
  ROLES_SCRIPT_VERSION,
} from './roles.ts';
import {
  isLoopbackHost,
  MAINTENANCE_DATABASE,
  readDatabaseName,
  readSecret,
  readServerConnection,
  readSetting,
  type Env,
} from './settings.ts';

/** `pnpm db:drop` and `pnpm db:types` refuse any other database (ADR 0005). */
const DEVELOPMENT_PREFIX = 'tps_';

type Step = 'prepare' | 'up' | 'down' | 'drop' | 'status';
const STEPS: readonly Step[] = ['prepare', 'up', 'down', 'drop', 'status'];

function parseArguments(argv: readonly string[]): { steps: Step[]; test: boolean } {
  const steps: Step[] = [];
  let test = false;
  for (const argument of argv) {
    if (argument === '--') continue;
    if (argument === '--test') {
      test = true;
    } else if ((STEPS as readonly string[]).includes(argument)) {
      steps.push(argument as Step);
    } else {
      throw new Error(
        `Unknown argument ${argument}. Use prepare, up, down, drop or status, and optionally --test.`,
      );
    }
  }
  if (steps.length === 0) {
    throw new Error('Name at least one step: prepare, up, down, drop or status.');
  }
  return { steps, test };
}

const descriptors = new Map<number, string>();

/**
 * Read a secret file. /dev/fd/N is read from descriptor N, once: the
 * operator cli hands a typed admin password over a pipe there, so it never
 * reaches a disk, and Linux cannot reopen by path the socket Node.js gives
 * a child. prepare connects twice, so the value is kept for the second.
 */
export function readSecretFile(path: string): string {
  const match = /^\/dev\/fd\/(\d+)$/.exec(path);
  if (!match) return readFileSync(path, 'utf8');
  const descriptor = Number(match[1]);
  const value = descriptors.get(descriptor) ?? readFileSync(descriptor, 'utf8');
  descriptors.set(descriptor, value);
  return value;
}

async function withSuperuser<T>(
  env: Env,
  database: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    ...readServerConnection(env),
    database,
    user: readSetting(env, 'TPS_DB_SUPERUSER'),
    password: readSecret(env, 'TPS_DB_SUPERUSER_PASSWORD', readSecretFile),
    application_name: 'tps-db-scripts',
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function prepareDatabase(env: Env, database: string): Promise<void> {
  // Check every password before connecting, so a refused one changes nothing.
  for (const role of LOGIN_ROLES) readRolePassword(env, role);
  await withSuperuser(env, MAINTENANCE_DATABASE, async (client) => {
    await applyRoles(client, env);
    const { rows } = await client.query<{ owner: string }>(
      'SELECT datdba::regrole::text AS owner FROM pg_catalog.pg_database WHERE datname = $1',
      [database],
    );
    const existing = rows[0];
    if (!existing) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)} OWNER migrator`);
      console.log(`Created database ${database}.`);
    } else if (existing.owner !== 'migrator') {
      throw new Error(
        `Database ${database} is owned by ${existing.owner}, not migrator. Refusing to prepare it.`,
      );
    }
  });
  const mode = readAdminMode(env);
  await withSuperuser(env, database, (client) => applyDatabasePrivileges(client, mode));
  console.log(
    `Applied roles script version ${ROLES_SCRIPT_VERSION} to ${database}` +
      (mode === 'managed' ? ', and every role matches it.' : '.'),
  );
}

/**
 * Development commands, `pnpm db:drop` and `pnpm db:types`, work only on
 * this worktree's own databases, on this machine, in development (ADR 0005).
 * scripts/dev-env.ts lists them in TPS_DEV_DATABASES from the worktree's
 * folder name, and nothing can override that list. `verb` names the action
 * in the error, such as "drop".
 */
export function checkOwnDatabase(env: Env, database: string, verb: string): void {
  if (env['TPS_DEV'] !== '1') {
    throw new Error(`Refusing to ${verb} ${database}: this works only in development (TPS_DEV=1).`);
  }
  const host = readSetting(env, 'TPS_DB_HOST');
  if (!isLoopbackHost(host)) {
    throw new Error(`Refusing to ${verb} a database on ${host}: this works only on this machine.`);
  }
  if (!database.startsWith(DEVELOPMENT_PREFIX)) {
    throw new Error(
      `Refusing to ${verb} ${database}: its name does not start with ${DEVELOPMENT_PREFIX}.`,
    );
  }
  const own = (env['TPS_DEV_DATABASES'] ?? '').split(',').filter(Boolean);
  if (!own.includes(database)) {
    throw new Error(`Refusing to ${verb} ${database}: it is not this worktree's database.`);
  }
}

export async function dropDatabase(env: Env, database: string): Promise<void> {
  checkOwnDatabase(env, database, 'drop');
  await withSuperuser(env, MAINTENANCE_DATABASE, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(database)} WITH (FORCE)`);
  });
  console.log(`Dropped database ${database}.`);
}

function migratorPool(env: Env, database: string): pg.Pool {
  return new pg.Pool({
    ...readServerConnection(env),
    database,
    user: 'migrator',
    password: readSecret(env, 'TPS_DB_MIGRATOR_PASSWORD'),
    application_name: 'tps-migrate',
    max: 1,
  });
}

export async function migrateDatabase(
  env: Env,
  database: string,
  direction: 'up' | 'down',
): Promise<void> {
  const pool = migratorPool(env, database);
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    const client = await pool.connect();
    try {
      await assertRoles(client, readAdminRole(env));
    } finally {
      client.release();
    }

    const migrator = createMigrator(db);
    const { error, results = [] } =
      direction === 'up' ? await migrator.migrateToLatest() : await migrator.migrateDown();
    for (const result of results) {
      const verb = result.direction === 'Up' ? 'Applied' : 'Rolled back';
      console.log(`${result.status === 'Success' ? verb : 'Failed'} ${result.migrationName}`);
    }
    if (error) {
      throw error instanceof Error ? error : new Error('The migration failed.', { cause: error });
    }
    if (results.length === 0) {
      console.log(direction === 'up' ? 'No pending migrations.' : 'No migration to roll back.');
    }
  } finally {
    await db.destroy();
  }
}

/** The worker's pg-boss connections name themselves this (apps/api/src/worker.ts). */
const WORKER_APPLICATION = 'tps-worker-queue';

/**
 * Report on the database as migrator, changing nothing and reading no
 * tenant's data. Returns each line and whether everything is as it should be.
 */
export async function databaseStatus(
  env: Env,
  database: string,
): Promise<{ lines: string[]; healthy: boolean }> {
  const pool = migratorPool(env, database);
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    const client = await pool.connect();
    let tls: boolean;
    let problems: string[];
    let workers: number;
    try {
      const ssl = await client.query<{ ssl: boolean }>(
        'SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()',
      );
      tls = ssl.rows[0]?.ssl === true;
      problems = await findRoleProblems(client, readAdminRole(env));
      const activity = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM pg_catalog.pg_stat_activity
          WHERE datname = pg_catalog.current_database() AND application_name = $1`,
        [WORKER_APPLICATION],
      );
      workers = activity.rows[0]?.count ?? 0;
    } finally {
      client.release();
    }
    const pending = (await createMigrator(db).getMigrations())
      .filter((migration) => migration.executedAt === undefined)
      .map((migration) => migration.name);

    const host = readSetting(env, 'TPS_DB_HOST');
    const lines = [
      `Database: connected to ${database} as migrator ${tls ? 'over TLS' : 'without TLS'}.`,
      problems.length === 0
        ? `Roles: match roles script version ${ROLES_SCRIPT_VERSION}.`
        : `Roles: do not match roles script version ${ROLES_SCRIPT_VERSION}:`,
      ...problems.map((problem) => `  - ${problem}`),
      pending.length === 0
        ? 'Migrations: none pending.'
        : `Migrations: ${String(pending.length)} pending: ${pending.join(', ')}.`,
      workers > 0 ? 'Worker: connected.' : 'Worker: not connected.',
    ];
    const healthy =
      (tls || isLoopbackHost(host)) && problems.length === 0 && pending.length === 0 && workers > 0;
    return { lines, healthy };
  } finally {
    await db.destroy();
  }
}

async function main(argv: readonly string[], env: Env): Promise<void> {
  const { steps, test } = parseArguments(argv);
  const database = readDatabaseName(env, test ? 'TPS_TEST_DB_NAME' : 'TPS_DB_NAME');
  for (const step of steps) {
    if (step === 'prepare') await prepareDatabase(env, database);
    else if (step === 'drop') await dropDatabase(env, database);
    else if (step === 'status') {
      const { lines, healthy } = await databaseStatus(env, database);
      for (const line of lines) console.log(line);
      if (!healthy) process.exitCode = 1;
    } else await migrateDatabase(env, database, step);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
