// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The cli changes nothing itself: it runs the release's own commands
// (packages/db/scripts/db.ts and the operator command) with this Node.js.
// Each gets a fresh environment: the operator's non-secret TPS_ settings, the
// few system variables Node.js needs, and each secret as a *_FILE path.
// Nothing secret goes in an argument or an environment value, and each line
// the command prints passes through the redacting writer. A secret typed at
// the prompt goes over a pipe, so it never reaches a disk, even if the cli
// is stopped part way.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable, type Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { isLoopbackHost } from '@pixel-scientists/db';

import { CliError } from './errors.ts';
import type { Output } from './output.ts';

/** The checkout or unpacked release this cli belongs to. */
export const RELEASE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const DB_SCRIPT = 'packages/db/scripts/db.ts';
export const OPERATOR_SCRIPT = 'apps/api/src/operator/create-tenant.ts';

export type Env = Readonly<Record<string, string | undefined>>;

/** The *_FILE path at which a script reads the secret runScript pipes to it. */
export const PIPED_SECRET_FILE = '/dev/fd/3';

export type RunScript = (
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  output: Output,
  piped?: string,
) => Promise<number>;

/** Settings that hold a secret's value rather than a file's path, such as TPS_AUTH_SECRET_2. */
const SECRET_VALUE = /^TPS_\w*(?:PASSWORD|SECRET|KEY|KEK|TOKEN)(?:_\d+)?$/i;

/** Variables Node.js itself may need, on Windows in particular. */
const SYSTEM = new Set(['PATH', 'SYSTEMROOT', 'TZ']);

/** Refuse any setting that holds a secret: the cli reads secrets from files only. */
export function checkNoSecretValues(env: Env): void {
  const named = Object.keys(env).filter((name) => SECRET_VALUE.test(name) && env[name]);
  if (named.length > 0) {
    throw new CliError(
      `${named.join(', ')} holds a secret, and the cli takes secrets from files only. ` +
        `Unset it, and keep the secret in the secrets folder or in a file named by ${named[0] ?? ''}_FILE.`,
    );
  }
}

/**
 * Refuse a database server elsewhere unless the connection verifies TLS
 * (TPS_DB_TLS=verify-full), before anything connects.
 */
export function checkDatabaseTls(env: Env): void {
  const host = env['TPS_DB_HOST'];
  if (!host) throw new CliError('Set TPS_DB_HOST to the database server.');
  if (!isLoopbackHost(host) && env['TPS_DB_TLS'] !== 'verify-full') {
    throw new CliError(
      `The database server at ${host} is not on this machine, so the cli reaches it over TLS only. ` +
        'Set TPS_DB_TLS=verify-full, with TPS_DB_TLS_CA_FILE if the server uses its own certificate authority.',
    );
  }
}

/** The environment for a command: non-secret settings, then `files`, the secrets' *_FILE paths. */
export function childEnv(
  env: Env,
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (SYSTEM.has(upper) || (upper.startsWith('TPS_') && !SECRET_VALUE.test(name))) {
      result[name] = value;
    }
  }
  return { ...result, ...files };
}

function relay(stream: Readable | null, write: (line: string) => void): Promise<void> {
  if (!stream) return Promise.resolve();
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', write);
  return new Promise((resolve) => lines.once('close', resolve));
}

/**
 * Run one of the release's scripts with this Node.js, and return its exit
 * code. `piped` is written to the script's descriptor 3 (PIPED_SECRET_FILE).
 */
export const runScript: RunScript = async (script, args, env, output, piped) => {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: RELEASE_ROOT,
    env: { ...env },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', piped === undefined ? 'ignore' : 'pipe'],
  });
  const pipe = child.stdio[3];
  if (piped !== undefined && pipe instanceof Writable) {
    // A script that stops before reading it closes the pipe; its exit code says why.
    pipe.on('error', () => undefined);
    pipe.end(piped);
  }
  const exited = new Promise<number>((resolve) => {
    child.once('error', () => {
      resolve(1);
    });
    child.once('close', (code) => {
      resolve(code ?? 1);
    });
  });
  const [code] = await Promise.all([
    exited,
    relay(child.stdout, (line) => {
      output.out(line);
    }),
    relay(child.stderr, (line) => {
      output.err(line);
    }),
  ]);
  return code;
};
