// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the worker reads from the environment (ADR 0005): the database
// settings the API reads (config.ts), the passwords of app_worker and
// app_queue, and telemetry. It never reads the API's, the migrator's or the
// auth role's password. Every problem is reported at once.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';

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
}

const MINIMUM_PASSWORD_LENGTH = 16;
const DEVELOPMENT_PASSWORD = /not-a-secret$/;

/**
 * Settings that only the API's listener, its own role and the mail server
 * use, given fixed values so the shared database rules can be reused. They
 * override the environment, so the API's password is never read.
 */
const UNUSED = {
  TPS_API_HOST: '127.0.0.1',
  TPS_API_PORT: '1',
  TPS_DB_APP_API_PASSWORD: 'unused-by-the-worker',
  TPS_DB_APP_API_PASSWORD_FILE: '',
  TPS_SMTP_HOST: '127.0.0.1',
  TPS_SMTP_PORT: '1',
  TPS_SMTP_TLS: 'none',
  TPS_SMTP_FROM: 'unused@example.org',
  TPS_SMTP_USER: '',
  TPS_SMTP_PASSWORD: '',
  TPS_SMTP_PASSWORD_FILE: '',
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
  if (
    config === undefined ||
    workerPassword === undefined ||
    queuePassword === undefined ||
    telemetry === undefined
  ) {
    throw new ConfigError(problems);
  }
  const { host, port, database: name, tls } = config.database;
  const database = { host, port, database: name, tls };
  return { logLevel: config.logLevel, database, workerPassword, queuePassword, telemetry };
}
