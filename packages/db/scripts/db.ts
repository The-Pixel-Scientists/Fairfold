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
//   drop     As the superuser: drop this worktree's database. Development
//            only.
//
//   --test   Use PIXELGRANT_TEST_DB_NAME instead of PIXELGRANT_DB_NAME.
//
// Settings come from the environment (settings.ts). In development,
// `pnpm db:migrate`, `pnpm db:rollback` and `pnpm db:drop` supply them.
// Test set-up can import the same steps.

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import { createMigrator } from './migrations.ts';
import { applyDatabasePrivileges, applyRoles, assertRoles } from './roles.ts';
import {
  MAINTENANCE_DATABASE,
  readDatabaseName,
  readSecret,
  readServer,
  readSetting,
  type Env,
} from './settings.ts';

/** `pnpm db:drop` refuses any other database (ADR 0005). */
const DROPPABLE_PREFIX = 'pixelgrant_';

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

type Step = 'prepare' | 'up' | 'down' | 'drop';
const STEPS: readonly Step[] = ['prepare', 'up', 'down', 'drop'];

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
        `Unknown argument ${argument}. Use prepare, up, down or drop, and optionally --test.`,
      );
    }
  }
  if (steps.length === 0) throw new Error('Name at least one step: prepare, up, down or drop.');
  return { steps, test };
}

async function withSuperuser<T>(
  env: Env,
  database: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    ...readServer(env),
    database,
    user: readSetting(env, 'PIXELGRANT_DB_SUPERUSER'),
    password: readSecret(env, 'PIXELGRANT_DB_SUPERUSER_PASSWORD'),
    application_name: 'pixelgrant-db-scripts',
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function prepareDatabase(env: Env, database: string): Promise<void> {
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
  await withSuperuser(env, database, (client) => applyDatabasePrivileges(client));
  console.log(`Applied the roles script to ${database}.`);
}

/**
 * `pnpm db:drop` may drop only this worktree's own databases, on this
 * machine, in development (ADR 0005). scripts/dev-env.ts lists them in
 * PIXELGRANT_DEV_DATABASES from the worktree's folder name, and nothing can
 * override that list.
 */
export function checkDroppable(env: Env, database: string): void {
  if (env['PIXELGRANT_DEV'] !== '1') {
    throw new Error('db drop runs only in development (PIXELGRANT_DEV=1).');
  }
  const host = readSetting(env, 'PIXELGRANT_DB_HOST');
  if (!LOOPBACK_HOSTS.has(host) && !/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    throw new Error(`Refusing to drop a database on ${host}: db drop works only on this machine.`);
  }
  if (!database.startsWith(DROPPABLE_PREFIX)) {
    throw new Error(
      `Refusing to drop ${database}: its name does not start with ${DROPPABLE_PREFIX}.`,
    );
  }
  const own = (env['PIXELGRANT_DEV_DATABASES'] ?? '').split(',').filter(Boolean);
  if (!own.includes(database)) {
    throw new Error(`Refusing to drop ${database}: it is not this worktree's database.`);
  }
}

export async function dropDatabase(env: Env, database: string): Promise<void> {
  checkDroppable(env, database);
  await withSuperuser(env, MAINTENANCE_DATABASE, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(database)} WITH (FORCE)`);
  });
  console.log(`Dropped database ${database}.`);
}

export async function migrateDatabase(
  env: Env,
  database: string,
  direction: 'up' | 'down',
): Promise<void> {
  const pool = new pg.Pool({
    ...readServer(env),
    database,
    user: 'migrator',
    password: readSecret(env, 'PIXELGRANT_DB_MIGRATOR_PASSWORD'),
    application_name: 'pixelgrant-migrate',
    max: 1,
  });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    const client = await pool.connect();
    try {
      await assertRoles(client);
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

async function main(argv: readonly string[], env: Env): Promise<void> {
  const { steps, test } = parseArguments(argv);
  const database = readDatabaseName(env, test ? 'PIXELGRANT_TEST_DB_NAME' : 'PIXELGRANT_DB_NAME');
  for (const step of steps) {
    if (step === 'prepare') await prepareDatabase(env, database);
    else if (step === 'drop') await dropDatabase(env, database);
    else await migrateDatabase(env, database, step);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
