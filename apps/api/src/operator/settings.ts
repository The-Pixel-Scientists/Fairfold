// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the operator command reads from the environment (ADR 0005): the
// database as app_worker, the mail server, and the console's address for the
// invitation link. The database and mail rules are the API's own
// (config.ts), so a setting means the same in both. Every problem is
// reported at once.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';

import { ConfigError, loadConfig, Secret, type Config } from '../config.ts';

export interface OperatorSettings {
  readonly database: Omit<Config['database'], 'password'> & { readonly password: Secret };
  readonly smtp: Config['smtp'];
  /** The console's origin and any path prefix, before a tenant's slug. */
  readonly consoleBase: string;
}

const MINIMUM_PASSWORD_LENGTH = 16;
const DEVELOPMENT_PASSWORD = /not-a-secret$/;
const PATH_PREFIX = /^\/[a-z0-9][a-z0-9-]{0,62}$/;

/** Settings that only the API's listener and its own role use, so they are given fixed values here. */
const UNUSED = {
  TPS_API_HOST: '127.0.0.1',
  TPS_API_PORT: '1',
  TPS_DB_APP_API_PASSWORD: 'unused-by-the-operator',
  TPS_DB_APP_API_PASSWORD_FILE: '',
} as const;

function consoleBase(env: Env): string {
  const prefix = env['TPS_CONSOLE_PATH_PREFIX'] || '';
  const problem = 'TPS_CONSOLE_ORIGIN must be an origin such as https://grants.example.org.';
  let url: URL;
  try {
    url = new URL(env['TPS_CONSOLE_ORIGIN'] ?? '');
  } catch {
    throw new Error(problem);
  }
  const local =
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    isLoopbackHost(url.hostname);
  if (
    url.origin === 'null' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  ) {
    throw new Error(`${problem} Use https, except for a localhost name on this machine.`);
  }
  if (prefix !== '' && !PATH_PREFIX.test(prefix)) {
    throw new Error('TPS_CONSOLE_PATH_PREFIX must be one path segment, such as /console.');
  }
  return `${url.origin}${prefix}`;
}

/** Read and check the settings, or throw a ConfigError naming every problem. */
export function loadOperatorSettings(env: Env): OperatorSettings {
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
  const password = attempt(() => {
    const secret = readSecret(env, 'TPS_DB_APP_WORKER_PASSWORD');
    if (secret.length < MINIMUM_PASSWORD_LENGTH) {
      throw new Error(
        `TPS_DB_APP_WORKER_PASSWORD must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`,
      );
    }
    if (
      DEVELOPMENT_PASSWORD.test(secret) &&
      !(env['TPS_DEV'] === '1' && isLoopbackHost(env['TPS_DB_HOST'] ?? ''))
    ) {
      throw new Error(
        'TPS_DB_APP_WORKER_PASSWORD is a development password, which works only with ' +
          'TPS_DEV=1 against a database server on this machine. Set a real one.',
      );
    }
    return new Secret(secret);
  });
  const base = attempt(() => consoleBase(env));

  if (config === undefined || password === undefined || base === undefined || problems.length > 0) {
    throw new ConfigError(problems);
  }
  return {
    database: { ...config.database, password },
    smtp: config.smtp,
    consoleBase: base,
  };
}
