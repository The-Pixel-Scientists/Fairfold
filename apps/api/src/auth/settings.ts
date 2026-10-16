// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth module's settings (ADR 0010), read from the environment and
// checked before anything starts. Every problem is reported at once, as
// config.ts does.
//
//   TPS_AUTH_SECRET or TPS_AUTH_SECRET_FILE   at least 32 bytes; never a known
//                                             default, nor a development value
//                                             outside TPS_DEV=1
//   TPS_DB_APP_AUTH_PASSWORD(_FILE)           the app_auth role's password
//   TPS_CONSOLE_ORIGIN, TPS_PORTAL_ORIGIN     each app's exact origin: https,
//                                             or http only for localhost names
//   TPS_CONSOLE_PATH_PREFIX                   only when both apps share one
//                                             host: the console's fixed path
//                                             prefix, such as /console
//
// The trusted proxies are TPS_API_TRUST_PROXY, which config.ts reads; Fastify
// derives each request's host through them.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';
import type { App } from '@pixel-scientists/domain/platform';

import { ConfigError, Secret } from '../config.ts';
import { normaliseHost } from './hosts.ts';

export interface AuthSettings {
  /** TPS_DEV=1. */
  readonly development: boolean;
  readonly secret: Secret;
  /** The app_auth role's password. */
  readonly databasePassword: Secret;
  /** Each app's origin, as a browser sends it in `Origin`. */
  readonly origins: Readonly<Record<App, string>>;
  /** Set exactly when both apps share one host: the console is served under it. */
  readonly consolePathPrefix?: string;
}

const MINIMUM_SECRET_BYTES = 32;
const MINIMUM_PASSWORD_LENGTH = 16;

/** Better Auth's built-in default secret. */
const KNOWN_DEFAULTS = new Set(['better-auth-secret-12345678901234567890']);

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

/** Read and check the settings, or throw a ConfigError naming every problem. */
export function loadAuthSettings(env: Env, readFile?: (path: string) => string): AuthSettings {
  const problems: string[] = [];
  const development = env['TPS_DEV'] === '1';
  const developmentServer = development && isLoopbackHost(env['TPS_DB_HOST'] ?? '');

  const secret = secretOrProblem(env, 'TPS_AUTH_SECRET', readFile);
  if (typeof secret !== 'string') problems.push(secret.problem);
  else if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    problems.push(`TPS_AUTH_SECRET must be at least ${String(MINIMUM_SECRET_BYTES)} bytes.`);
  } else if (KNOWN_DEFAULTS.has(secret) || (DEVELOPMENT_VALUE.test(secret) && !development)) {
    problems.push('TPS_AUTH_SECRET is a published value. Set a random one of at least 32 bytes.');
  }

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

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    development,
    secret: new Secret(secret as string),
    databasePassword: new Secret(password as string),
    origins: { console: consoleOrigin as string, portal: portalOrigin as string },
    ...(prefix === undefined ? {} : { consolePathPrefix: prefix }),
  };
}
