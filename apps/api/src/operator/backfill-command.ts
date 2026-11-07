// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one-off grants backfill (ADR 0024). No tool is on without a row, so
// every tenant that exists before the policy changes needs a grants row.
// This adds an enabled one where a tenant has none; an explicit off stays
// off. Each tenant is set in turn as app_worker, so a run writes only
// through the tenant the helper sets. A second run writes nothing. It
// prints counts only, never a tenant's name or slug.
//
// Deploy order: migrate, run this backfill, then roll out the API with the
// new policy. The policy before the backfill turns grants off everywhere.

import { randomUUID } from 'node:crypto';

import { createDatabase } from '@pixel-scientists/db';
import { forEachTenant } from '@pixel-scientists/db/jobs';

import { ConfigError } from '../config.ts';
import { loadOperatorSettings } from './settings.ts';
import { switchModulesOn } from './switch-on.ts';
import type { Output } from './command.ts';

const USAGE =
  'Usage: pnpm tenants:backfill-grants\n' +
  'Deploy order: migrate, run this backfill, then roll out the API with the new policy.\n' +
  'It adds grants where a tenant has no row. Run it again only after the policy change is rolled out.';

export async function runBackfillGrants(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  output: Output,
): Promise<number> {
  if (argv.length > 0) {
    output.err(USAGE);
    return 2;
  }
  let settings;
  try {
    settings = loadOperatorSettings(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const problem of error.problems) output.err(problem);
    return 2;
  }
  const { database } = settings;
  const worker = createDatabase<unknown>({
    host: database.host,
    port: database.port,
    database: database.database,
    role: 'app_worker',
    password: database.password.reveal(),
    applicationName: 'tps-operator',
    tls: database.tls,
  });
  const requestId = randomUUID();
  let tenants = 0;
  let switched = 0;
  try {
    await forEachTenant(worker, async (trx) => {
      tenants += 1;
      switched += await switchModulesOn(trx, requestId, ['grants']);
    });
  } catch {
    output.err(
      `The backfill stopped after ${tenants} tenants and ${switched} grants rows. ` +
        'Run it again: tenants already done are skipped.',
    );
    return 1;
  } finally {
    await worker.destroy();
  }
  output.out(`Checked ${tenants} tenants. Switched grants on for ${switched}.`);
  return 0;
}
