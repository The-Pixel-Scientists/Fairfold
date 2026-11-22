// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed: fills an empty database with synthetic tenants and staff, so
// anyone can sign in and work through a round.
//
//   pnpm db:seed [scenario]     this worktree's development database
//   pnpm stack seed [scenario]  the stack's database
//
// Scenarios: base, configured (the default), applications, volume and
// wave1. Both commands supply the settings (scripts/dev-env.ts and
// scripts/stack.ts). guard.ts holds every check on where the seed may write;
// it connects as migrator. Every account's password is TPS_SEED_PASSWORD, or
// the contents of the file TPS_SEED_PASSWORD_FILE names; it is never printed.

import pg from 'pg';

import { readRolePassword } from '../scripts/roles.ts';
import type { Env } from '../scripts/settings.ts';
import { applications } from './applications.ts';
import { base } from './base.ts';
import { writeVolume } from './bulk.ts';
import { configured } from './configured.ts';
import { checkConnection, checkTarget, readSeedPassword } from './guard.ts';
import { wave1 } from './scenarios/wave1/index.ts';
import {
  applicantEmailOf,
  applicationsOf,
  emailOf,
  writeScenario,
  type Scenario,
} from './scenario.ts';

/** A scenario as the command runs it: written through a migrator client, then the lines to print. */
export type Seed = (client: pg.ClientBase, password: string) => Promise<readonly string[]>;

/** Write a scenario of tables, then list its accounts, which are all synthetic. */
export const tables =
  (scenario: Scenario): Seed =>
  async (client, password) => {
    await writeScenario(client, scenario, password);
    return scenario.flatMap((tenant) => [
      '',
      `${tenant.name}, at /${tenant.slug}`,
      ...tenant.staff.map((member) => `  ${emailOf(tenant, member)}  ${member[2]}`),
      ...applicationsOf(tenant).map(
        ({ applicant }) => `  ${applicantEmailOf(tenant, applicant)}  applicant`,
      ),
    ]);
  };

/** Write the volume scenario, then say how many rows it wrote of each table, and nothing else. */
const volume: Seed = async (client, password) => {
  const { rows } = await writeVolume(client, password);
  return ['', ...Object.entries(rows).map(([table, ids]) => `  ${table}: ${String(ids.length)}`)];
};

export const SCENARIOS = new Map<string, Seed>([
  ['base', tables(base)],
  ['configured', tables(configured)],
  ['applications', tables(applications)],
  ['volume', volume],
  ['wave1', wave1],
]);

async function main(argv: readonly string[], env: Env): Promise<void> {
  const [name = 'configured', ...rest] = argv.filter((argument) => argument !== '--');
  const seed = SCENARIOS.get(name);
  if (seed === undefined || rest.length > 0) {
    throw new Error(`Name one scenario: ${[...SCENARIOS.keys()].join(' or ')}.`);
  }
  const target = checkTarget(env);
  const password = readSeedPassword(env);
  const client = new pg.Client({
    ...target.server,
    database: target.database,
    user: 'migrator',
    password: readRolePassword(env, 'migrator'),
    application_name: 'tps-seed',
  });
  await client.connect();
  let lines: readonly string[];
  try {
    await checkConnection(client, target.database);
    lines = await seed(client, password);
  } finally {
    await client.end();
  }

  const passwordFrom = env['TPS_SEED_PASSWORD_FILE'] || 'TPS_SEED_PASSWORD';
  console.log(`Seeded ${target.database} with the ${name} scenario.`);
  console.log(`Each account signs in with the seed password, from ${passwordFrom}.`);
  for (const line of lines) console.log(line);
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
