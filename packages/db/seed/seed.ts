// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The development seed: fills an empty development or stack database with
// synthetic tenants and staff, so anyone can sign in and work through a
// round.
//
//   pnpm db:seed [base | configured]      this worktree's development database
//   pnpm stack seed [base | configured]   the stack's database
//
// `configured` is the default. Both commands supply the settings
// (scripts/dev-env.ts and scripts/stack.ts). The seed refuses to run unless
// TPS_DEV=1, the server is on this machine, and the database is this
// worktree's development or stack database, and it refuses a database that
// already has tenants. It connects as migrator. Every account's password is
// TPS_SEED_PASSWORD, or the contents of the file TPS_SEED_PASSWORD_FILE
// names; it is never printed.

import { passwordSchema } from '@pixel-scientists/domain/auth';
import pg from 'pg';

import { readRolePassword } from '../scripts/roles.ts';
import {
  isLoopbackHost,
  readDatabaseName,
  readSecret,
  readServer,
  readSetting,
  type Env,
} from '../scripts/settings.ts';
import { base } from './base.ts';
import { configured } from './configured.ts';
import { emailOf, writeScenario, type Scenario } from './scenario.ts';

const SCENARIOS = new Map<string, Scenario>([
  ['base', base],
  ['configured', configured],
]);

/**
 * The database to seed, once every check has passed. Each refusal says which
 * check failed. TPS_DEV_DATABASES lists this worktree's own databases, or
 * the stack's, and nothing a developer sets can change it.
 */
export function checkTarget(env: Env): string {
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
  return database;
}

/** The seed password, which must be one the API would accept. Never part of a message. */
export function readSeedPassword(env: Env): string {
  const password = readSecret(env, 'TPS_SEED_PASSWORD');
  if (!passwordSchema.safeParse(password).success) {
    throw new Error('The seed password must be 12 to 256 characters.');
  }
  return password;
}

/**
 * Refuse a database that has, or has had, a tenant. Forced row-level security
 * hides every tenant from migrator, so this asks whether the tenant table has
 * ever stored a row: a newly migrated one has no pages.
 */
export async function checkNoTenants(client: pg.ClientBase, database: string): Promise<void> {
  const { rows } = await client.query<{ used: boolean }>(
    "SELECT pg_catalog.pg_relation_size('app.tenant') > 0 AS used",
  );
  if (rows[0]?.used !== false) {
    throw new Error(
      `Refusing to seed ${database}: it already has tenants. Seed an empty database: ` +
        'pnpm db:drop && pnpm db:migrate, or pnpm stack down --volumes && pnpm stack.',
    );
  }
}

async function main(argv: readonly string[], env: Env): Promise<void> {
  const [name = 'configured', ...rest] = argv.filter((argument) => argument !== '--');
  const scenario = SCENARIOS.get(name);
  if (scenario === undefined || rest.length > 0) {
    throw new Error(`Name one scenario: ${[...SCENARIOS.keys()].join(' or ')}.`);
  }
  const database = checkTarget(env);
  const password = readSeedPassword(env);
  const client = new pg.Client({
    ...readServer(env),
    database,
    user: 'migrator',
    password: readRolePassword(env, 'migrator'),
    application_name: 'tps-seed',
  });
  await client.connect();
  try {
    await checkNoTenants(client, database);
    await writeScenario(client, scenario, password);
  } finally {
    await client.end();
  }

  const passwordFrom = env['TPS_SEED_PASSWORD_FILE'] || 'TPS_SEED_PASSWORD';
  console.log(`Seeded ${database} with the ${name} scenario.`);
  console.log(`Each account signs in with the seed password, from ${passwordFrom}.`);
  for (const tenant of scenario) {
    console.log(`\n${tenant.name}, at /${tenant.slug}`);
    for (const member of tenant.staff) console.log(`  ${emailOf(tenant, member)}  ${member[2]}`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
