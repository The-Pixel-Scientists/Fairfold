// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs a command with this worktree's development settings:
//
//   node scripts/dev-env.ts <profile> <command> [arguments...]
//
// Connection details and the fixed development credentials come from the
// development Compose file, read through `docker compose config`, so they
// live in that one file. Database names and ports come from dev-names.ts.
//
// Each profile names the only Fairfold Grants variables its command receives, so
// a command never gets a credential it does not use (ADR 0005). Any other
// TPS_ variable, in any letter case, is removed from the command's
// environment. For the profile's variables, a non-empty value in the
// environment wins, then one in the repository's .env file (see
// .env.example), then the development value.
//
// The auth secret and the seed password are random for each worktree, made
// on first use and kept outside the checkout in
// ~/.tps/dev/<database>, one file each, readable by this user only.
// Commands get the path of the file, never the value.
//
// The S3 key pairs come from the seaweedfs-s3 config in the same file:
// dev-scanner writes and dev-downloads reads (ADR 0047). dev-admin only
// creates this worktree's bucket (ensureDevBucket) and reaches no command.
//
// This is for development only. It sets TPS_DEV=1, and so refuses to
// run against a database server that is not on this machine: the fixed
// development passwords must never be set on a shared server.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** Random for each worktree; see secretsFolder(). */
const SECRET_FILES = ['TPS_AUTH_SECRET_FILE', 'TPS_SEED_PASSWORD_FILE'] as const;
const CONSOLE_ORIGIN = 'TPS_CONSOLE_ORIGIN';
const SMTP = [
  'TPS_SMTP_HOST',
  'TPS_SMTP_PORT',
  'TPS_SMTP_TLS',
  'TPS_SMTP_USER',
  'TPS_SMTP_PASSWORD',
  'TPS_SMTP_FROM',
] as const;
/** Storage and scanner settings for the file service (ADR 0047). */
const FILES = [
  'TPS_STORAGE_ENDPOINT',
  'TPS_STORAGE_REGION',
  'TPS_STORAGE_BUCKET',
  'TPS_STORAGE_WRITE_ACCESS_KEY_ID',
  'TPS_STORAGE_WRITE_SECRET_ACCESS_KEY',
  'TPS_STORAGE_READ_ACCESS_KEY_ID',
  'TPS_STORAGE_READ_SECRET_ACCESS_KEY',
  'TPS_CLAMD_HOST',
  'TPS_CLAMD_PORT',
  'TPS_CLAMD_TIMEOUT_MS',
  'TPS_FILES_MAX_STORES',
] as const;

/** SHA-256 of an empty body, which S3 needs in x-amz-content-sha256. */
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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
  // roles, with migrator for fixtures, and the file service's storage and
  // scanner. No superuser.
  'database-tests': [
    ...CONNECTION,
    'TPS_TEST_DB_NAME',
    MIGRATOR_PASSWORD,
    ...APP_PASSWORDS,
    ...FILES,
  ],
  // The API in `pnpm dev`: this worktree's database as app_api, and as
  // app_auth for the auth module, on its port, behind the Vite dev servers'
  // proxies on this machine. Mail goes to Mailpit, files to SeaweedFS and clamd.
  api: [
    ...CONNECTION,
    'TPS_DB_NAME',
    'TPS_DB_APP_API_PASSWORD',
    'TPS_DB_APP_AUTH_PASSWORD',
    'TPS_API_PORT',
    'TPS_API_TRUST_PROXY',
    'TPS_AUTH_SECRET_FILE',
    CONSOLE_ORIGIN,
    'TPS_PORTAL_ORIGIN',
    ...SMTP,
    ...FILES,
  ],
  // pnpm db:seed: this worktree's database as migrator. The seed checks the
  // database against the own-database list.
  seed: [...CONNECTION, 'TPS_DB_NAME', MIGRATOR_PASSWORD, 'TPS_SEED_PASSWORD_FILE', OWN_DATABASES],
  // pnpm tenant:create: this worktree's database as app_worker. The first
  // invitation links to the console and goes to Mailpit.
  operator: [...CONNECTION, 'TPS_DB_NAME', 'TPS_DB_APP_WORKER_PASSWORD', CONSOLE_ORIGIN, ...SMTP],
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
  configs?: Record<string, { content?: string }>;
}

interface StorageKey {
  accessKey: string;
  secretKey: string;
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

/** The key pair of a SeaweedFS identity in the seaweedfs-s3 config. */
function storageKey(config: ComposeConfig, name: string): StorageKey {
  const content = config.configs?.['seaweedfs-s3']?.content;
  if (!content) throw new Error('The development Compose file has no seaweedfs-s3 config.');
  const { identities } = JSON.parse(content) as {
    identities: { name: string; credentials: StorageKey[] }[];
  };
  const key = identities.find((identity) => identity.name === name)?.credentials[0];
  if (!key) throw new Error(`The seaweedfs-s3 config has no ${name} identity.`);
  return key;
}

/** Where a worktree keeps its auth secret and seed password. */
export function secretsFolder(database: string): string {
  return join(homedir(), '.tps', 'dev', database);
}

/** Every development setting for this worktree, before overrides. */
export function developmentValues(
  config: ComposeConfig,
  names: {
    database: string;
    testDatabase: string;
    bucket: string;
    ports: { api: number; console: number; portal: number };
  },
  secrets: string,
): Record<string, string> {
  const postgres = service(config, 'postgres');
  const postgresPort = publishedPort(postgres, 'postgres', 5432);
  const mailpit = service(config, 'mailpit');
  const smtpPort = publishedPort(mailpit, 'mailpit', 1025);
  // user:password, the one login Mailpit accepts.
  const smtpLogin = environmentValue(mailpit, 'mailpit', 'MP_SMTP_AUTH');
  const separator = smtpLogin.indexOf(':');
  if (separator < 1) throw new Error('The mailpit service must set MP_SMTP_AUTH as user:password.');
  const storagePort = publishedPort(service(config, 'seaweedfs'), 'seaweedfs', 8333);
  const clamdPort = publishedPort(service(config, 'clamav'), 'clamav', 3310);
  const writeKey = storageKey(config, 'dev-scanner');
  const readKey = storageKey(config, 'dev-downloads');
  const values: Record<string, string> = {
    TPS_DEV: '1',
    TPS_API_PORT: String(names.ports.api),
    // The Vite dev servers' proxies run on this machine.
    TPS_API_TRUST_PROXY: '127.0.0.1,::1',
    TPS_CONSOLE_ORIGIN: `http://console.localhost:${String(names.ports.console)}`,
    TPS_PORTAL_ORIGIN: `http://portal.localhost:${String(names.ports.portal)}`,
    TPS_AUTH_SECRET_FILE: join(secrets, 'auth_secret'),
    TPS_SEED_PASSWORD_FILE: join(secrets, 'seed_password'),
    TPS_SMTP_HOST: smtpPort.host_ip ?? '127.0.0.1',
    TPS_SMTP_PORT: smtpPort.published ?? '',
    // Mailpit on this machine. The API accepts none only for a loopback host.
    TPS_SMTP_TLS: 'none',
    TPS_SMTP_USER: smtpLogin.slice(0, separator),
    TPS_SMTP_PASSWORD: smtpLogin.slice(separator + 1),
    TPS_SMTP_FROM: 'no-reply@example.org',
    TPS_STORAGE_ENDPOINT: `http://${storagePort.host_ip ?? '127.0.0.1'}:${storagePort.published ?? ''}`,
    TPS_STORAGE_REGION: 'us-east-1',
    TPS_STORAGE_BUCKET: names.bucket,
    TPS_STORAGE_WRITE_ACCESS_KEY_ID: writeKey.accessKey,
    TPS_STORAGE_WRITE_SECRET_ACCESS_KEY: writeKey.secretKey,
    TPS_STORAGE_READ_ACCESS_KEY_ID: readKey.accessKey,
    TPS_STORAGE_READ_SECRET_ACCESS_KEY: readKey.secretKey,
    TPS_CLAMD_HOST: clamdPort.host_ip ?? '127.0.0.1',
    TPS_CLAMD_PORT: clamdPort.published ?? '',
    // ADR 0047: the API gives up 5 seconds after clamd's MaxScanTime.
    TPS_CLAMD_TIMEOUT_MS: '25000',
    TPS_FILES_MAX_STORES: '4',
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

/** The inherited environment without any TPS_ variable, in any letter case. */
export function withoutOurVariables(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !key.toUpperCase().startsWith('TPS_')) env[key] = value;
  }
  return env;
}

/**
 * The environment for a Vite dev server: the inherited one without any
 * TPS_ variable, plus the address its proxy sends `/api` to. Only the
 * app's vite.config.ts reads that, and no `envPrefix` exposes it, so nothing
 * a developer has set can reach a bundle.
 */
export function viteEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  apiPort: number,
): Record<string, string> {
  return {
    ...withoutOurVariables(inherited),
    TPS_API_ORIGIN: `http://127.0.0.1:${String(apiPort)}`,
  };
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
  const env = withoutOurVariables(inherited);
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

/** Make a random secret at `path` unless one is there, readable by this user only. */
export function ensureSecretFile(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
}

/**
 * The Docker arguments that ask SeaweedFS, as dev-admin, to create `bucket`.
 * curl in the SeaweedFS image signs the request; it prints the HTTP status.
 */
export function createBucketArgs(config: ComposeConfig, bucket: string): string[] {
  const admin = storageKey(config, 'dev-admin');
  return [
    'compose',
    '--file',
    COMPOSE_FILE,
    'exec',
    '-T',
    'seaweedfs',
    'curl',
    '--silent',
    '--show-error',
    '--output',
    '/dev/null',
    '--write-out',
    '%{http_code}',
    '--retry',
    '30',
    '--retry-connrefused',
    '--aws-sigv4',
    'aws:amz:us-east-1:s3',
    '--user',
    `${admin.accessKey}:${admin.secretKey}`,
    '--header',
    `x-amz-content-sha256: ${EMPTY_BODY_SHA256}`,
    '--upload-file',
    '/dev/null',
    `http://127.0.0.1:8333/${bucket}`,
  ];
}

/** Create this worktree's bucket as dev-admin, unless it exists. */
export function ensureDevBucket(): void {
  const { bucket } = currentDevNames();
  const status = execFileSync('docker', createBucketArgs(readComposeConfig(), bucket), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  // 409: it exists already.
  if (status !== '200' && status !== '409') {
    throw new Error(`Storage answered ${status} when asked to create the bucket ${bucket}.`);
  }
}

/** The environment for a command run with `profile` in this worktree. */
export function developmentEnvironment(profile: Profile): Record<string, string> {
  const names = currentDevNames();
  const values = developmentValues(readComposeConfig(), names, secretsFolder(names.database));
  const env = profileEnvironment(
    profile,
    values,
    [existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}, process.env],
    process.env,
    [names.database, names.testDatabase],
  );
  // Only this worktree's own files are made; a path set in .env must exist.
  for (const key of SECRET_FILES) {
    const path = env[key];
    if (path !== undefined && path === values[key]) ensureSecretFile(path);
  }
  return env;
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
