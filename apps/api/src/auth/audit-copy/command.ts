// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit-copy replay command (ADR 0010, "Audit"), run by the operator
// when the oldest pending copy is too old. Its only options are a batch
// limit and --dry-run: the tenant, actor and events come from the database
// alone (rule 6). It reads the settings as the API does and connects as
// app_auth and app_api. A bad option ends with the usage and nothing
// written. It prints counts only, never an id, an address or an error.

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { createDatabase, type Env } from '@pixel-scientists/db';

import { ConfigError, loadConfig } from '../../config.ts';
import { loadAuthSettings } from '../settings.ts';
import { MAX_LIMIT, replayAuthCopies } from './replay.ts';

const USAGE = `Usage: replay-command.ts [--limit <1 to ${String(MAX_LIMIT)}>] [--dry-run]`;
const DEFAULT_LIMIT = 500;

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

/** Settings that only the API's listener uses. */
const UNUSED = { TPS_API_HOST: '127.0.0.1', TPS_API_PORT: '1' } as const;

/** The batch limit, or undefined if the options are not ones the command takes. */
function batchLimit(argv: readonly string[]): { limit: number; dryRun: boolean } | undefined {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { limit: { type: 'string' }, 'dry-run': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    });
    const text = values.limit ?? String(DEFAULT_LIMIT);
    const limit = Number(text);
    if (!/^[1-9][0-9]*$/.test(text) || limit > MAX_LIMIT) return undefined;
    return { limit, dryRun: values['dry-run'] === true };
  } catch {
    return undefined;
  }
}

/** Run the command. Returns the exit code: 0 unless an event failed or the input was bad. */
export async function runAuditCopyReplay(
  argv: readonly string[],
  env: Env,
  output: Output,
): Promise<number> {
  const options = batchLimit(argv);
  if (options === undefined) {
    output.err(USAGE);
    return 2;
  }
  let settings;
  let config;
  try {
    settings = loadAuthSettings(env);
    config = loadConfig({ ...env, ...UNUSED });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const problem of error.problems) output.err(problem);
    return 2;
  }

  const { database } = config;
  const connection = {
    host: database.host,
    port: database.port,
    database: database.database,
    applicationName: 'tps-audit-copy-replay',
    maxConnections: 1,
    ...(database.tls === undefined ? {} : { tls: database.tls }),
  };
  const api = createDatabase<unknown>({
    ...connection,
    role: 'app_api',
    password: database.password.reveal(),
  });
  const auth = createDatabase<unknown>({
    ...connection,
    role: 'app_auth',
    password: settings.databasePassword.reveal(),
  });
  try {
    const counts = await replayAuthCopies({ api, auth }, { ...options, requestId: randomUUID() });
    const n = (outcome: keyof typeof counts) => String(counts[outcome]);
    if (options.dryRun) {
      output.out('Dry run: nothing was written.');
      output.out(`${n('due')} pending copies are due to be written or found already written.`);
      output.out(`${n('cleared')} pending copies are due to be cleared with no copy.`);
      return 0;
    }
    output.out(`Copied ${n('copied')} auth events to their tenant's audit log.`);
    output.out(`Found ${n('found')} already copied.`);
    output.out(`Cleared ${n('cleared')} with no copy due.`);
    const failed = counts.failed_constraint + counts.failed_connection + counts.failed_other;
    if (failed === 0) return 0;
    output.err(
      `${String(failed)} failed and stay pending: constraint ${n('failed_constraint')}, ` +
        `connection ${n('failed_connection')}, other ${n('failed_other')}. Run the command again.`,
    );
    return 1;
  } finally {
    await Promise.all([api.destroy(), auth.destroy()]);
  }
}
