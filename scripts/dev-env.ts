// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs a command with this worktree's development settings:
//
//   node scripts/dev-env.ts <profile> <command> [arguments...]
//
// Connection details and the fixed development credentials come from the
// development Compose file, read through `docker compose config`, so they
// live in that one file. Database names come from dev-names.ts.
//
// Each profile names the only Fairfold Grants variables its command receives, so
// a command never gets a credential it does not use (ADR 0005). Any other
// TPS_ variable, in any letter case, is removed from the command's
// environment. For the profile's variables, a non-empty value in the
// environment wins, then one in the repository's .env file (see
// .env.example), then the development value.
//
// This is for development only. It sets TPS_DEV=1, and so refuses to
// run against a database server that is not on this machine: the fixed
// development passwords must never be set on a shared server.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import { currentDevNames, repositoryRoot } from './dev-names.ts';

const COMPOSE_FILE = join(repositoryRoot, 'infra', 'compose', 'compose.dev.yaml');
const ENV_FILE = join(repositoryRoot, '.env');

const CONNECTION = ['TPS_DEV', 'TPS_DB_HOST', 'TPS_DB_PORT'] as const;
const SUPERUSER = ['TPS_DB_SUPERUSER', 'TPS_DB_SUPERUSER_PASSWORD'] as const;
const MIGRATOR_PASSWORD = 'TPS_DB_MIGRATOR_PASSWORD';
const APP_PASSWORDS = [
  'TPS_DB_APP_API_PASSWORD',
  'TPS_DB_APP_WORKER_PASSWORD',
  'TPS_DB_APP_AUTH_PASSWORD',
  'TPS_DB_APP_QUEUE_PASSWORD',
] as const;

/** Set from the worktree's folder name. Nothing overrides it. */
const OWN_DATABASES = 'TPS_DEV_DATABASES';

export const PROFILES = {
  // pnpm db:migrate, db:rollback and db:drop, and the db-admin tests. The
  // roles script sets every role's password, so it needs them all, and the
  // superuser to run it.
  'database-admin': [
    ...CONNECTION,
    'TPS_DB_NAME',
    'TPS_TEST_DB_NAME',
    ...SUPERUSER,
    MIGRATOR_PASSWORD,
    ...APP_PASSWORDS,
    OWN_DATABASES,
  ],
  // Database tests in the db project: the test database only, as the app
  // roles, with migrator for fixtures. No superuser.
  'database-tests': [...CONNECTION, 'TPS_TEST_DB_NAME', MIGRATOR_PASSWORD, ...APP_PASSWORDS],
  // The API in `pnpm dev`: this worktree's database as app_api, on its port.
  api: [...CONNECTION, 'TPS_DB_NAME', 'TPS_DB_APP_API_PASSWORD', 'TPS_API_PORT'],
} as const satisfies Record<string, readonly string[]>;

export type Profile = keyof typeof PROFILES;

interface ComposePort {
  target: number;
  published?: string;
  host_ip?: string;
}

interface ComposeService {
  environment?: Record<string, string | null>;
  ports?: ComposePort[];
}

export interface ComposeConfig {
  services?: Record<string, ComposeService>;
}

function readComposeConfig(): ComposeConfig {
  try {
    const output = execFileSync(
      'docker',
      ['compose', '--file', COMPOSE_FILE, 'config', '--format', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output) as ComposeConfig;
  } catch (error) {
    throw new Error(
      `Could not read ${COMPOSE_FILE} with docker compose. Install Docker, then start the ` +
        `services with: docker compose -f infra/compose/compose.dev.yaml up -d --wait\n${String(error)}`,
      { cause: error },
    );
  }
}

function service(config: ComposeConfig, name: string): ComposeService {
  const found = config.services?.[name];
  if (!found) throw new Error(`The development Compose file has no ${name} service.`);
  return found;
}

function environmentValue(found: ComposeService, serviceName: string, key: string): string {
  const value = found.environment?.[key];
  if (!value) throw new Error(`The ${serviceName} service does not set ${key}.`);
  return value;
}

function publishedPort(found: ComposeService, serviceName: string, target: number): ComposePort {
  const port = found.ports?.find((candidate) => candidate.target === target);
  if (!port?.published) {
    throw new Error(`The ${serviceName} service does not publish port ${String(target)}.`);
  }
  return port;
}

/** Every development setting for this worktree, before overrides. */
export function developmentValues(
  config: ComposeConfig,
  names: { database: string; testDatabase: string; ports: { api: number } },
): Record<string, string> {
  const postgres = service(config, 'postgres');
  const postgresPort = publishedPort(postgres, 'postgres', 5432);
  const values: Record<string, string> = {
    TPS_DEV: '1',
    TPS_API_PORT: String(names.ports.api),
    TPS_DB_HOST: postgresPort.host_ip ?? '127.0.0.1',
    TPS_DB_PORT: postgresPort.published ?? '',
    TPS_DB_NAME: names.database,
    TPS_TEST_DB_NAME: names.testDatabase,
    TPS_DB_SUPERUSER: environmentValue(postgres, 'postgres', 'POSTGRES_USER'),
    TPS_DB_SUPERUSER_PASSWORD: environmentValue(postgres, 'postgres', 'POSTGRES_PASSWORD'),
  };
  for (const key of [MIGRATOR_PASSWORD, ...APP_PASSWORDS]) {
    values[key] = environmentValue(postgres, 'postgres', key);
  }
  return values;
}

/** The same rule as isLoopbackHost in packages/db/scripts/settings.ts. */
export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return isIPv4(host) && host.startsWith('127.');
}

/**
 * The environment for a command: the inherited one without any TPS_
 * variable, plus exactly the profile's variables. Throws if the database
 * host is not on this machine.
 */
export function profileEnvironment(
  profile: Profile,
  values: Readonly<Record<string, string>>,
  overrides: readonly Readonly<Record<string, string | undefined>>[],
  inherited: Readonly<Record<string, string | undefined>>,
  ownDatabases: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !key.toUpperCase().startsWith('TPS_')) env[key] = value;
  }
  for (const key of PROFILES[profile]) {
    if (key === OWN_DATABASES) {
      env[key] = ownDatabases.join(',');
      continue;
    }
    let value = values[key];
    for (const source of overrides) {
      const override = source[key];
      if (override !== undefined && override !== '') value = override;
    }
    if (value !== undefined) env[key] = value;
  }
  const host = env['TPS_DB_HOST'];
  if (host !== undefined && !isLoopbackHost(host)) {
    throw new Error(
      `TPS_DB_HOST is ${host}. The development commands work only against a database ` +
        'server on this machine. For any other server, run packages/db/scripts/db.ts with its ' +
        'own credentials.',
    );
  }
  return env;
}

function isProfile(name: string): name is Profile {
  return Object.hasOwn(PROFILES, name);
}

/** The environment for a command run with `profile` in this worktree. */
export function developmentEnvironment(profile: Profile): Record<string, string> {
  const names = currentDevNames();
  return profileEnvironment(
    profile,
    developmentValues(readComposeConfig(), names),
    [existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}, process.env],
    process.env,
    [names.database, names.testDatabase],
  );
}

function main(argv: readonly string[]): number {
  const [profile, command, ...args] = argv;
  if (!profile || !isProfile(profile) || !command) {
    console.error(
      `Usage: node scripts/dev-env.ts <${Object.keys(PROFILES).join('|')}> <command> [arguments...]`,
    );
    return 2;
  }

  const env = developmentEnvironment(profile);

  // Run Node.js commands with this Node.js, so no shell is needed on Windows.
  const executable = command === 'node' ? process.execPath : command;
  const result = spawnSync(executable, args, { cwd: repositoryRoot, env, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
