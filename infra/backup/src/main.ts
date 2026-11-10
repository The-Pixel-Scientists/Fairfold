// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Entry point of the off-site backup job. It prints one line, the run record,
// and exits non-zero unless the snapshot is complete. The scratch directory
// holds the database password file for the run, and is removed whatever
// happens.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BackupError, failureCode } from './codes.ts';
import { passFileLine } from './commands.ts';
import { runBackup, withScratch } from './job.ts';
import { readSettings, type Settings } from './settings.ts';
import { createStore, storeExec } from './store.ts';
import { createTools } from './tools.ts';

function report(line: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function refuse(error: unknown): void {
  report({ outcome: 'settings_invalid' });
  // Settings errors name a variable, not a value; the log line stays a code.
  process.stderr.write(`${error instanceof Error ? error.message : 'Settings refused.'}\n`);
  process.exitCode = 1;
}

/** Writes the pgpass file and reads the recipients; a failure reports only its code. */
function prepare(settings: Settings, scratch: string): { passFile: string; recipients: string } {
  try {
    const password = readFileSync(settings.passwordFile, 'utf8').replace(/\r?\n$/, '');
    const passFile = join(scratch, 'pgpass');
    writeFileSync(passFile, passFileLine(settings, password), { mode: 0o600, flag: 'wx' });
    return { passFile, recipients: readFileSync(settings.recipientsFile, 'utf8') };
  } catch {
    throw new BackupError('settings_invalid');
  }
}

async function run(settings: Settings, scratch: string): Promise<void> {
  const { passFile, recipients } = prepare(settings, scratch);
  const record = await runBackup({
    store: createStore(settings.store, storeExec(settings, scratch)),
    tools: createTools(settings, scratch, passFile),
    scratch,
    applicationDatabase: settings.applicationDatabase,
    otherDatabases: settings.otherDatabases,
    keyId: settings.keyId,
    recipients,
    // Whole seconds, because some stores keep retention dates to the second.
    now: () => new Date(Math.floor(Date.now() / 1000) * 1000),
    suffix: randomBytes(4).toString('hex'),
  });
  report({ ...record });
  if (record.outcome !== 'ok' && record.outcome !== 'already_complete') process.exitCode = 1;
}

async function main(): Promise<void> {
  let settings: Settings;
  try {
    settings = readSettings(process.env);
  } catch (error) {
    refuse(error);
    return;
  }
  await withScratch(settings.scratchParent, async (scratch) => {
    try {
      await run(settings, scratch);
    } catch (error) {
      report({ outcome: failureCode(error) });
      process.exitCode = 1;
    }
  });
}

await main();
