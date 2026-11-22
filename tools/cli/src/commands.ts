// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The cli's commands. Each checks its settings before it reads a secret,
// and every database step runs through the release's own scripts.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isLoopbackHost } from '@pixel-scientists/db';

import {
  LOGIN_ROLES,
  passwordVariable,
  readAdminMode,
  ROLES_SCRIPT_VERSION,
} from '../../../packages/db/scripts/roles.ts';
import {
  checkDatabaseTls,
  checkNoSecretValues,
  childEnv,
  DB_SCRIPT,
  OPERATOR_SCRIPT,
  PIPED_SECRET_FILE,
  type Env,
  type RunScript,
} from './child.ts';
import { COMPOSE_FILE, composeSecrets } from './compose.ts';
import { CliError } from './errors.ts';
import type { Output } from './output.ts';
import type { Prompt } from './prompt.ts';
import { createSecrets, openSecrets, rolePasswordFile, SECRET_NAMES } from './secrets.ts';

export interface Context {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly output: Output;
  readonly runScript: RunScript;
  readonly prompt: Prompt;
  readonly fetch: typeof fetch;
}

export type Values = Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;

const API_TIMEOUT_MS = 5_000;

function text(values: Values, name: string, command: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CliError(`Give --${name}. Run tps ${command} --help to see how.`, 2);
  }
  return value;
}

/** The settings and secrets folder a database command needs, checked before any secret is read. */
function prepare(values: Values, context: Context, command: string) {
  const dir = text(values, 'secrets-dir', command);
  checkNoSecretValues(context.env);
  checkDatabaseTls(context.env);
  return openSecrets(dir, context.platform, context.output);
}

export function install(values: Values, context: Context): Promise<number> {
  const folder = createSecrets(text(values, 'secrets-dir', 'install'), context.platform, [
    COMPOSE_FILE,
  ]);
  const compose = join(folder, COMPOSE_FILE);
  writeFileSync(compose, composeSecrets(folder), { flag: 'wx', mode: 0o600 });
  const { out } = context.output;
  out(`Made ${String(SECRET_NAMES.length)} secrets in ${folder}, each readable by you only.`);
  out(`Mount them with Compose by adding --file ${compose} after your Compose file.`);
  out(
    'Keep a copy of auth_secret and subject_kek with your backups: data sealed with them cannot be read without them.',
  );
  out(`Next, set up the database roles with: tps roles --secrets-dir ${folder}`);
  return Promise.resolve(0);
}

export async function roles(values: Values, context: Context): Promise<number> {
  const { env, output } = context;
  const mode = readAdminMode(env);
  const host = env['TPS_DB_HOST'] ?? '';
  if (mode === 'superuser' && host !== '' && !isLoopbackHost(host)) {
    throw new CliError(
      `The roles script runs as a superuser only on a database server on this machine, not ${host}. ` +
        'For a managed database, set TPS_DB_ADMIN_MODE=managed and TPS_DB_SUPERUSER to its admin role.',
    );
  }
  const secrets = prepare(values, context, 'roles');
  const admin = env['TPS_DB_SUPERUSER'];
  if (!admin) {
    throw new CliError('Set TPS_DB_SUPERUSER to the role the roles script runs as.');
  }
  const files: Record<string, string> = Object.fromEntries(
    LOGIN_ROLES.map((role) => [
      `${passwordVariable(role)}_FILE`,
      secrets.path(rolePasswordFile(role)),
    ]),
  );
  let typed: string | undefined;
  if (mode === 'managed') {
    typed = await context.prompt(`Password for the admin role ${admin} (not shown): `);
    if (typed === '') {
      throw new CliError("Type the admin role's password, or pipe it in from a file.");
    }
    output.protect(typed);
    files['TPS_DB_SUPERUSER_PASSWORD_FILE'] = PIPED_SECRET_FILE;
  } else {
    files['TPS_DB_SUPERUSER_PASSWORD_FILE'] = secrets.path('postgres_password');
  }
  output.out(`Running roles script version ${ROLES_SCRIPT_VERSION} in ${mode} mode.`);
  return context.runScript(DB_SCRIPT, ['prepare'], childEnv(env, files), output, typed);
}

export async function migrate(values: Values, context: Context): Promise<number> {
  const secrets = prepare(values, context, 'migrate');
  const files = { TPS_DB_MIGRATOR_PASSWORD_FILE: secrets.path('migrator_password') };
  return context.runScript(DB_SCRIPT, ['up'], childEnv(context.env, files), context.output);
}

export async function tenantCreate(values: Values, context: Context): Promise<number> {
  const command = 'tenant create';
  const slug = text(values, 'slug', command);
  const name = text(values, 'name', command);
  const email = text(values, 'admin-email', command);
  const modules = values['modules'];
  if (typeof modules !== 'string' || modules.trim() === '') {
    throw new CliError(
      'Name the tools to switch on with --modules, such as --modules grants. No tool is on unless you list it.',
      2,
    );
  }
  const secrets = prepare(values, context, command);
  const files = { TPS_DB_APP_WORKER_PASSWORD_FILE: secrets.path('app_worker_password') };
  // --option=value, so a value that starts with a dash stays a value.
  const args = [
    `--slug=${slug}`,
    `--name=${name}`,
    `--admin-email=${email}`,
    `--modules=${modules}`,
  ];
  return context.runScript(OPERATOR_SCRIPT, args, childEnv(context.env, files), context.output);
}

function apiAddress(values: Values): URL | undefined {
  const value = values['api'];
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new CliError('Give --api as an address such as http://127.0.0.1:3000.', 2);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new CliError('Give --api as an http or https address with no user name or password.', 2);
  }
  return url;
}

export async function status(values: Values, context: Context): Promise<number> {
  const api = apiAddress(values);
  const secrets = prepare(values, context, 'status');
  const { output } = context;
  const files = { TPS_DB_MIGRATOR_PASSWORD_FILE: secrets.path('migrator_password') };
  const database = await context.runScript(
    DB_SCRIPT,
    ['status'],
    childEnv(context.env, files),
    output,
  );
  if (api === undefined) {
    output.out('API: not checked. Give --api with its address to check it.');
    return database;
  }
  let ready = false;
  try {
    const response = await context.fetch(new URL('/health/ready', api), {
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    ready = response.ok;
    output.out(ready ? 'API: ready.' : `API: not ready (HTTP ${String(response.status)}).`);
  } catch {
    output.out(`API: not reached at ${api.origin}.`);
  }
  return database === 0 && ready ? 0 : 1;
}
