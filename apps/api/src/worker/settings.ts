// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the worker reads from the environment (ADR 0005): the database
// settings the API reads (config.ts), the passwords of app_worker and
// app_queue, the mail server and the portal's origin (for the release emails),
// and telemetry. It never reads the API's, the migrator's or the
// auth role's password. Every problem is reported at once.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';

import { loadFileSettings, type FileSettings } from '../platform/files/index.ts';
import { ConfigError, loadConfig, Secret, type Config, type LogLevel } from '../config.ts';
import { loadTelemetrySettings, type TelemetrySettings } from '../telemetry/index.ts';

export interface WorkerSettings {
  readonly logLevel: LogLevel;
  /** Host, port, name and TLS; the passwords are below. */
  readonly database: Omit<Config['database'], 'password'>;
  /** The handlers' role. */
  readonly workerPassword: Secret;
  /** pg-boss's own role. */
  readonly queuePassword: Secret;
  readonly telemetry: TelemetrySettings;
  /** The object store, with the removal key, and clamd, for the files job. */
  readonly files: FileSettings;
  /** The mail server the release emails go through. */
  readonly smtp: Config['smtp'];
  /** The applicant portal's origin, which the release emails link to. */
  readonly portalOrigin: string;
}

const MINIMUM_PASSWORD_LENGTH = 16;
const DEVELOPMENT_PASSWORD = /not-a-secret$/;

/**
 * Settings that only the API's listener and its own role use, given fixed
 * values so the shared database rules can be reused. They override the
 * environment, so the API's password is never read.
 */
const UNUSED = {
  TPS_API_HOST: '127.0.0.1',
  TPS_API_PORT: '1',
  TPS_DB_APP_API_PASSWORD: 'unused-by-the-worker',
  TPS_DB_APP_API_PASSWORD_FILE: '',
} as const;

function password(env: Env, name: string): Secret {
  const secret = readSecret(env, name);
  if (secret.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`);
  }
  if (
    DEVELOPMENT_PASSWORD.test(secret) &&
    !(env['TPS_DEV'] === '1' && isLoopbackHost(env['TPS_DB_HOST'] ?? ''))
  ) {
    throw new Error(
      `${name} is a development password, which works only with TPS_DEV=1 ` +
        'against a database server on this machine. Set a real one.',
    );
  }
  return new Secret(secret);
}

/** The portal's origin: https, or http for a name on this machine, with no path. */
function portalOrigin(env: Env): string {
  const value = env['TPS_PORTAL_ORIGIN'] ?? '';
  if (value === '') throw new Error('Set TPS_PORTAL_ORIGIN.');
  const problem =
    'TPS_PORTAL_ORIGIN must be an origin such as https://grants.example.org, with no path.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(problem);
  }
  const extra = url.username || url.password || url.search || url.hash || url.pathname !== '/';
  if (url.origin === 'null' || extra || /[?#]/.test(value)) throw new Error(problem);
  const local =
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(
      'TPS_PORTAL_ORIGIN must use https, except for a localhost name on this machine.',
    );
  }
  return url.origin;
}

/** Read and check the settings, or throw a ConfigError naming every problem. */
export function loadWorkerSettings(env: Env): WorkerSettings {
  const problems: string[] = [];
  const attempt = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ConfigError) problems.push(...error.problems);
      else problems.push(error instanceof Error ? error.message : 'A setting is not valid.');
      return undefined;
    }
  };
  const config = attempt(() => loadConfig({ ...env, ...UNUSED }));
  const workerPassword = attempt(() => password(env, 'TPS_DB_APP_WORKER_PASSWORD'));
  const queuePassword = attempt(() => password(env, 'TPS_DB_APP_QUEUE_PASSWORD'));
  const telemetry = attempt(() => loadTelemetrySettings(env));
  const files = attempt(() => loadFileSettings(env, undefined, { removal: true }));
  const origin = attempt(() => portalOrigin(env));
  if (
    config === undefined ||
    workerPassword === undefined ||
    queuePassword === undefined ||
    telemetry === undefined ||
    files === undefined ||
    origin === undefined
  ) {
    throw new ConfigError(problems);
  }
  const { host, port, database: name, tls } = config.database;
  const database = { host, port, database: name, tls };
  return {
    logLevel: config.logLevel,
    database,
    workerPassword,
    queuePassword,
    telemetry,
    files,
    smtp: config.smtp,
    portalOrigin: origin,
  };
}
