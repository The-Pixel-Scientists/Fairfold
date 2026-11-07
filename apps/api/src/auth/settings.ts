// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth module's settings (ADR 0010), read from the environment and
// checked before anything starts. Every problem is reported at once, as
// config.ts does.
//
//   TPS_AUTH_SECRET or TPS_AUTH_SECRET_FILE   at least 32 bytes; never a known
//                                             default, nor a development value
//                                             outside TPS_DEV=1
//   TPS_AUTH_SECRET_<n>(_FILE)                key version n (1 to 999), checked
//                                             the same way; TPS_AUTH_SECRET is
//                                             version 1
//   TPS_AUTH_SECRET_CURRENT                   the version that seals new values;
//                                             needed when more than one is set
//   TPS_DB_APP_AUTH_PASSWORD(_FILE)           the app_auth role's password
//   TPS_CONSOLE_ORIGIN, TPS_PORTAL_ORIGIN     each app's exact origin: https,
//                                             or http only for localhost names
//   TPS_CONSOLE_PATH_PREFIX                   only when both apps share one
//                                             host: the console's fixed path
//                                             prefix, such as /console
//   TPS_AUTH_BREACH_CHECK                     on (the default) or off: the
//                                             breached-password check; off
//                                             only for offline installs
//
// The trusted proxies are TPS_API_TRUST_PROXY, which config.ts reads; Fastify
// derives each request's host through them.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';
import type { App } from '@pixel-scientists/domain/platform';

import { ConfigError, Secret } from '../config.ts';
import { normaliseHost } from './hosts.ts';

/** The auth secret by key version (ADR 0010, "Secrets at rest"). */
export interface AuthSecrets {
  /** The version that seals new values. */
  readonly current: number;
  readonly versions: ReadonlyMap<number, Secret>;
}

export interface AuthSettings {
  /** TPS_DEV=1. */
  readonly development: boolean;
  /** The current version's secret: keys for values that are not kept long. */
  readonly secret: Secret;
  readonly secrets: AuthSecrets;
  /** The app_auth role's password. */
  readonly databasePassword: Secret;
  /** Each app's origin, as a browser sends it in `Origin`. */
  readonly origins: Readonly<Record<App, string>>;
  /** Set exactly when both apps share one host: the console is served under it. */
  readonly consolePathPrefix?: string;
  /** Whether new and pending passwords are checked against known breaches (ADR 0010). */
  readonly breachCheck: boolean;
}

const MINIMUM_SECRET_BYTES = 32;
const MINIMUM_PASSWORD_LENGTH = 16;

/** Better Auth's built-in default secret, and the one its published test helpers use. */
const KNOWN_DEFAULTS = new Set([
  'better-auth-secret-12345678901234567890',
  'better-auth-secret-that-is-long-enough-for-validation-test',
]);

/** The fixed development values in infra/compose/compose.dev.yaml all end like this. */
const DEVELOPMENT_VALUE = /not-a-secret$/;

const PATH_PREFIX = /^\/[a-z0-9][a-z0-9-]{0,62}$/;

/** The origin in `value`, normalised as browsers send it, or a problem. */
function parseOrigin(name: string, value: string | undefined): string | { problem: string } {
  const problem = `${name} must be an origin such as https://grants.example.org, with no path.`;
  if (value === undefined || value === '') return { problem: `Set ${name}.` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem };
  }
  const extra = url.username || url.password || url.search || url.hash || url.pathname !== '/';
  if (url.origin === 'null' || extra || /[?#]/.test(value)) return { problem };
  const local =
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { problem: `${name} must use https, except for a localhost name on this machine.` };
  }
  return url.origin;
}

function secretOrProblem(
  env: Env,
  name: string,
  readFile: ((path: string) => string) | undefined,
): string | { problem: string } {
  try {
    return readSecret(env, name, readFile);
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

const VERSIONED = /^TPS_AUTH_SECRET_([1-9][0-9]{0,2})(?:_FILE)?$/;
const VERSION = /^[1-9][0-9]{0,2}$/;

/** The auth secret's variable for each key version that is set. */
function secretNames(env: Env, problems: string[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !name.startsWith('TPS_AUTH_SECRET_')) continue;
    if (name === 'TPS_AUTH_SECRET_FILE' || name === 'TPS_AUTH_SECRET_CURRENT') continue;
    const version = VERSIONED.exec(name)?.[1];
    if (version === undefined) {
      problems.push(`${name} is not a setting. Name key versions TPS_AUTH_SECRET_1 to _999.`);
    } else names.set(Number(version), `TPS_AUTH_SECRET_${version}`);
  }
  if (env['TPS_AUTH_SECRET'] || env['TPS_AUTH_SECRET_FILE'] || names.size === 0) {
    if (names.has(1)) {
      problems.push('Set TPS_AUTH_SECRET or TPS_AUTH_SECRET_1, not both: each is version 1.');
    } else names.set(1, 'TPS_AUTH_SECRET');
  }
  return new Map([...names].sort(([a], [b]) => a - b));
}

/** Each key version's checked secret and the current version, or undefined after a problem. */
function readSecrets(
  env: Env,
  development: boolean,
  readFile: ((path: string) => string) | undefined,
  problems: string[],
): AuthSecrets | undefined {
  const names = secretNames(env, problems);
  const versions = new Map<number, Secret>();
  const seen = new Set<string>();
  for (const [version, name] of names) {
    const secret = secretOrProblem(env, name, readFile);
    if (typeof secret !== 'string') problems.push(secret.problem);
    else if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
      problems.push(`${name} must be at least ${String(MINIMUM_SECRET_BYTES)} bytes.`);
    } else if (KNOWN_DEFAULTS.has(secret) || (DEVELOPMENT_VALUE.test(secret) && !development)) {
      problems.push(`${name} is a published value. Set a random one of at least 32 bytes.`);
    } else if (seen.has(secret)) {
      problems.push(`${name} repeats another key version's secret. Set a new random one.`);
    } else {
      seen.add(secret);
      versions.set(version, new Secret(secret));
    }
  }

  const named = env['TPS_AUTH_SECRET_CURRENT'] || undefined;
  let current: number | undefined;
  if (named !== undefined) {
    if (VERSION.test(named) && names.has(Number(named))) current = Number(named);
    else problems.push('TPS_AUTH_SECRET_CURRENT must name a key version that is set.');
  } else if (names.size === 1) {
    current = [...names.keys()][0];
  } else {
    problems.push('More than one auth key version is set, so set TPS_AUTH_SECRET_CURRENT.');
  }
  return current === undefined || versions.size < names.size ? undefined : { current, versions };
}

/** Read and check the settings, or throw a ConfigError naming every problem. */
export function loadAuthSettings(env: Env, readFile?: (path: string) => string): AuthSettings {
  const problems: string[] = [];
  const development = env['TPS_DEV'] === '1';
  const developmentServer = development && isLoopbackHost(env['TPS_DB_HOST'] ?? '');

  const secrets = readSecrets(env, development, readFile, problems);

  const password = secretOrProblem(env, 'TPS_DB_APP_AUTH_PASSWORD', readFile);
  if (typeof password !== 'string') problems.push(password.problem);
  else if (password.length < MINIMUM_PASSWORD_LENGTH) {
    problems.push(
      `TPS_DB_APP_AUTH_PASSWORD must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`,
    );
  } else if (DEVELOPMENT_VALUE.test(password) && !developmentServer) {
    problems.push(
      'TPS_DB_APP_AUTH_PASSWORD is a development password, which works only with TPS_DEV=1 ' +
        'against a database server on this machine. Set a real one.',
    );
  }

  const consoleOrigin = parseOrigin('TPS_CONSOLE_ORIGIN', env['TPS_CONSOLE_ORIGIN']);
  const portalOrigin = parseOrigin('TPS_PORTAL_ORIGIN', env['TPS_PORTAL_ORIGIN']);
  for (const origin of [consoleOrigin, portalOrigin]) {
    if (typeof origin !== 'string') problems.push(origin.problem);
  }

  const prefix = env['TPS_CONSOLE_PATH_PREFIX'] || undefined;
  const oneHost =
    typeof consoleOrigin === 'string' &&
    typeof portalOrigin === 'string' &&
    normaliseHost(new URL(consoleOrigin).host) === normaliseHost(new URL(portalOrigin).host);
  if (oneHost && prefix === undefined) {
    problems.push(
      'TPS_CONSOLE_ORIGIN and TPS_PORTAL_ORIGIN share a host, so set TPS_CONSOLE_PATH_PREFIX, ' +
        'such as /console. Two host names are safer.',
    );
  } else if (prefix !== undefined && !oneHost) {
    problems.push('TPS_CONSOLE_PATH_PREFIX is used only when console and portal share a host.');
  } else if (prefix !== undefined && (!PATH_PREFIX.test(prefix) || prefix === '/api')) {
    problems.push(
      'TPS_CONSOLE_PATH_PREFIX must be one path segment of lower-case letters, digits and ' +
        'hyphens, such as /console, and not /api.',
    );
  }

  const breachCheck = env['TPS_AUTH_BREACH_CHECK'] || 'on';
  if (breachCheck !== 'on' && breachCheck !== 'off') {
    problems.push('TPS_AUTH_BREACH_CHECK must be on or off.');
  }

  if (problems.length > 0 || secrets === undefined) throw new ConfigError(problems);
  return {
    development,
    secret: secrets.versions.get(secrets.current) as Secret,
    secrets,
    databasePassword: new Secret(password as string),
    origins: { console: consoleOrigin as string, portal: portalOrigin as string },
    ...(prefix === undefined ? {} : { consolePathPrefix: prefix }),
    breachCheck: breachCheck === 'on',
  };
}
