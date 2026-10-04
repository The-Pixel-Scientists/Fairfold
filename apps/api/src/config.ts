// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API's settings, read from the environment only and checked with Zod
// before anything else starts (ADR 0005). Follows the conventions of the
// database scripts (packages/db/scripts/settings.ts):
//
//   - No default credentials or addresses. A missing value stops the API with
//     a message naming the variable. Only the log level has a default.
//   - A secret comes from NAME, or from the file named by NAME_FILE (a mounted
//     Compose or Kubernetes secret). Setting both is an error.
//   - A database server that is not on this machine needs TPS_DB_TLS:
//     verify-full, or disable on a private network such as Compose's.
//   - Proxies are trusted only by address: TPS_API_TRUST_PROXY lists
//     the addresses or ranges of the reverse proxy, and nothing is trusted
//     when it is unset.
//   - A development password is accepted only with TPS_DEV=1 and a
//     database server on this machine, and TPS_DEV=1 makes the
//     listener bind to the loopback address.
//
// Every problem is reported at once, so one restart fixes them all.

import { readFileSync } from 'node:fs';
import { isIP, isIPv4 } from 'node:net';

import { z } from 'zod';

export type Env = Readonly<Record<string, string | undefined>>;

/** A secret that never reaches a log line or a JSON document by accident. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The secret itself. Call this only where it is used. */
  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return '[redacted]';
  }

  toString(): string {
    return '[redacted]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'Secret([redacted])';
  }
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  /** TPS_DEV=1: development values may be used, and the listener binds to loopback. */
  readonly development: boolean;
  readonly logLevel: LogLevel;
  readonly listen: { readonly host: string; readonly port: number };
  /** Addresses or ranges of the reverse proxies whose forwarded headers are believed. */
  readonly trustProxy: readonly string[];
  /** Connection to PostgreSQL as the `app_api` role. */
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly password: Secret;
    /** Left out for a server on this machine, which is reached without TLS. */
    readonly tls?: { readonly mode: 'verify-full' | 'disable'; readonly ca?: string };
  };
}

/** Thrown when the environment does not hold a valid configuration. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        'The API cannot start because its settings are not valid:',
        ...problems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const MINIMUM_PASSWORD_LENGTH = 16;

/** The fixed development passwords in infra/compose/compose.dev.yaml all end like this. */
const DEVELOPMENT_PASSWORD = /not-a-secret$/;

/** The same rule as DATABASE_NAME in packages/db/scripts/settings.ts. */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const SYSTEM_DATABASES = new Set(['postgres', 'template0', 'template1']);

const HOST_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

const LOOPBACK_HOST = '127.0.0.1';

/** The same rule as isLoopbackHost in packages/db/scripts/settings.ts. */
export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return isIPv4(host) && host.startsWith('127.');
}

/**
 * Variables that can also come from a file, named by NAME_FILE. A secret has
 * its final newline removed, as a mounted secret file usually ends with one.
 */
const FILE_VARIABLES = [
  { name: 'TPS_DB_APP_API_PASSWORD', trimFinalNewline: true },
  { name: 'TPS_DB_TLS_CA', trimFinalNewline: false },
] as const;

function required(name: string): z.ZodString {
  return z.string({ error: () => `Set ${name}.` }).min(1, `Set ${name}.`);
}

function portVariable(name: string) {
  const message = `${name} must be a port number from 1 to 65535.`;
  return required(name)
    .regex(/^[0-9]{1,5}$/, message)
    .transform(Number)
    .pipe(z.number().min(1, message).max(65535, message));
}

function hostVariable(name: string): z.ZodString {
  const message = `${name} must be a host name or an IP address.`;
  return required(name).refine((host) => isIP(host) !== 0 || HOST_NAME.test(host), message);
}

const MAX_TRUSTED_PROXIES = 32;

/** An address, or a range such as 10.0.0.0/8. A range of every address trusts everyone, so it is refused. */
function isTrustedProxy(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return (
    /^[0-9]{1,3}$/.test(prefix) &&
    Number(prefix) >= 1 &&
    Number(prefix) <= (family === 4 ? 32 : 128)
  );
}

/**
 * The schema for the environment. Its keys are the variable names, so a
 * problem always names its variable. `development` is TPS_DEV, read
 * first, because it decides which address the listener may use.
 */
function environmentSchema(development: boolean) {
  return z
    .object({
      TPS_DEV: z
        .enum(['0', '1'], { error: () => 'TPS_DEV must be 1, or unset.' })
        .optional()
        .transform((value) => value === '1'),
      TPS_LOG_LEVEL: z
        .enum(LOG_LEVELS, {
          error: () => `TPS_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`,
        })
        .default('info'),
      // In development the listener binds to loopback, so no address is needed.
      TPS_API_HOST: development
        ? hostVariable('TPS_API_HOST')
            .refine(
              isLoopbackHost,
              'TPS_API_HOST must be a loopback address while TPS_DEV=1. ' +
                'Unset TPS_DEV to listen on another address.',
            )
            .optional()
        : hostVariable('TPS_API_HOST'),
      TPS_API_PORT: portVariable('TPS_API_PORT'),
      TPS_API_TRUST_PROXY: z
        .string()
        .transform((value) => value.split(',').map((entry) => entry.trim()))
        .pipe(
          z
            .array(z.string())
            .max(MAX_TRUSTED_PROXIES)
            .refine(
              (entries) => entries.every(isTrustedProxy),
              'TPS_API_TRUST_PROXY must list proxy addresses or ranges, such as 10.0.0.0/8, ' +
                'separated by commas. A range of every address is not allowed.',
            ),
        )
        .optional(),
      TPS_DB_HOST: hostVariable('TPS_DB_HOST'),
      TPS_DB_PORT: portVariable('TPS_DB_PORT'),
      TPS_DB_NAME: required('TPS_DB_NAME').refine(
        (name) => DATABASE_NAME.test(name) && !SYSTEM_DATABASES.has(name),
        'TPS_DB_NAME must be 1 to 63 characters of lower-case letters, digits and ' +
          "underscores, not starting with a digit, and not one of PostgreSQL's own databases.",
      ),
      TPS_DB_TLS: z
        .enum(['verify-full', 'disable'], {
          error: () => 'TPS_DB_TLS must be verify-full or disable.',
        })
        .optional(),
      // The server's own certificate authority, in PEM, when Node.js does not trust it already.
      TPS_DB_TLS_CA: z
        .string()
        .min(1, 'TPS_DB_TLS_CA must hold a certificate in PEM format.')
        .optional(),
      TPS_DB_APP_API_PASSWORD: z
        .string({
          error: () => 'Set TPS_DB_APP_API_PASSWORD or TPS_DB_APP_API_PASSWORD_FILE.',
        })
        .min(
          MINIMUM_PASSWORD_LENGTH,
          `TPS_DB_APP_API_PASSWORD must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`,
        ),
    })
    .superRefine((env, context) => {
      if (env.TPS_DB_TLS === undefined && !isLoopbackHost(env.TPS_DB_HOST)) {
        context.addIssue({
          code: 'custom',
          path: ['TPS_DB_TLS'],
          message:
            'Set TPS_DB_TLS to verify-full, or to disable on a private network. ' +
            'Only a database server on this machine is reached without TLS by default.',
        });
      }
      if (env.TPS_DB_TLS_CA !== undefined && env.TPS_DB_TLS !== 'verify-full') {
        context.addIssue({
          code: 'custom',
          path: ['TPS_DB_TLS_CA'],
          message: 'TPS_DB_TLS_CA is used only with TPS_DB_TLS=verify-full.',
        });
      }
      const developmentServer = env.TPS_DEV && isLoopbackHost(env.TPS_DB_HOST);
      if (DEVELOPMENT_PASSWORD.test(env.TPS_DB_APP_API_PASSWORD) && !developmentServer) {
        context.addIssue({
          code: 'custom',
          path: ['TPS_DB_APP_API_PASSWORD'],
          message:
            'TPS_DB_APP_API_PASSWORD is a development password, which works only with ' +
            'TPS_DEV=1 against a database server on this machine. Set a real one.',
        });
      }
    });
}

/** Every variable the schema reads, in the order problems are reported. */
const VARIABLES = Object.keys(environmentSchema(false).shape);

/**
 * Read a value from NAME, or from the file named by NAME_FILE. Returns a
 * problem instead of throwing, so every problem can be reported together.
 */
function resolveFileVariable(
  env: Env,
  name: string,
  trimFinalNewline: boolean,
  readFile: (path: string) => string,
): { value?: string; problem?: string } {
  const value = env[name] ?? '';
  const file = env[`${name}_FILE`] ?? '';
  if (value !== '' && file !== '') return { problem: `Set ${name} or ${name}_FILE, not both.` };
  if (file === '') return value === '' ? {} : { value };
  try {
    const content = readFile(file);
    return { value: trimFinalNewline ? content.replace(/\r?\n$/, '') : content };
  } catch {
    // The reason can name paths on the host, so say only which variable failed.
    return { problem: `${name}_FILE names a file that cannot be read.` };
  }
}

function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Validate the environment. Returns the configuration, or throws a
 * ConfigError that names every variable that is missing or not valid. A
 * variable set to an empty string counts as not set.
 */
export function loadConfig(env: Env, readFile: (path: string) => string = readTextFile): Config {
  const raw: Record<string, string | undefined> = {};
  for (const name of VARIABLES) {
    const value = env[name];
    raw[name] = value === '' ? undefined : value;
  }

  // Problems by variable, so a variable is reported once.
  const problems = new Map<string, string>();
  for (const { name, trimFinalNewline } of FILE_VARIABLES) {
    const resolved = resolveFileVariable(env, name, trimFinalNewline, readFile);
    raw[name] = resolved.value;
    if (resolved.problem !== undefined) problems.set(name, resolved.problem);
  }

  const result = environmentSchema(raw['TPS_DEV'] === '1').safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0]);
      if (!problems.has(name)) problems.set(name, issue.message);
    }
  }
  if (problems.size > 0 || !result.success) {
    const ordered = VARIABLES.flatMap((name) => {
      const problem = problems.get(name);
      return problem === undefined ? [] : [problem];
    });
    throw new ConfigError(ordered);
  }

  const values = result.data;
  const tlsMode = values.TPS_DB_TLS;
  const tlsCa = values.TPS_DB_TLS_CA;
  return {
    development: values.TPS_DEV,
    logLevel: values.TPS_LOG_LEVEL,
    listen: { host: values.TPS_API_HOST ?? LOOPBACK_HOST, port: values.TPS_API_PORT },
    trustProxy: values.TPS_API_TRUST_PROXY ?? [],
    database: {
      host: values.TPS_DB_HOST,
      port: values.TPS_DB_PORT,
      database: values.TPS_DB_NAME,
      password: new Secret(values.TPS_DB_APP_API_PASSWORD),
      tls:
        tlsMode === undefined
          ? undefined
          : { mode: tlsMode, ...(tlsCa === undefined ? {} : { ca: tlsCa }) },
    },
  };
}
