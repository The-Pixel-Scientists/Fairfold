// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The telemetry settings (ADR 0005), read from the environment only:
//
//   - TPS_OTEL_ENDPOINT: the base URL of an OTLP HTTP collector. Unset means
//     telemetry is off. The standard OTEL_* variables are never read, so they
//     cannot switch export on or move it.
//   - TPS_OTEL_HEADERS (or TPS_OTEL_HEADERS_FILE): headers the collector
//     needs, such as an authorisation header, as Name=value pairs separated
//     by commas. It is a secret and never appears in a message.
//   - TPS_OTEL_ENVIRONMENT: the deployment environment label. Defaults to
//     development with TPS_DEV=1, and production otherwise.
//
// A plain http endpoint is accepted only for this machine or with TPS_DEV=1,
// like the database TLS rule. Every problem is reported at once.

import { isLoopbackHost, readSecret, type Env } from '@pixel-scientists/db';
import { z } from 'zod';

import { ConfigError, hasControlCharacter, Secret } from '../config.ts';

export interface TelemetrySettings {
  /** The collector's base URL. Without it, telemetry is off. */
  readonly endpoint?: URL;
  /** The raw Name=value pairs; read them with `parseHeaders`. */
  readonly headers?: Secret;
  readonly environment: string;
}

/** The settings of a process that exports nothing. */
export const telemetryOff: TelemetrySettings = { environment: 'production' };

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_HEADERS = 16;
const MAX_HEADERS_LENGTH = 2048;

/** Name=value pairs, or undefined if the text is not that. */
export function parseHeaders(text: string): Record<string, string> | undefined {
  const pairs = text.split(',').map((pair) => pair.trim());
  if (pairs.length > MAX_HEADERS) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1).trim();
    if (at < 1 || !HEADER_NAME.test(name) || value === '' || hasControlCharacter(value)) {
      return undefined;
    }
    headers[name] = value;
  }
  return headers;
}

function endpointProblem(text: string, development: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'TPS_OTEL_ENDPOINT must be an http or https address, such as https://collector.example.org.';
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return 'TPS_OTEL_ENDPOINT must be an http or https address with no login, query or fragment.';
  }
  if (url.protocol === 'http:' && !development && !isLoopbackHost(url.hostname)) {
    return 'TPS_OTEL_ENDPOINT must use https, unless the collector is on this machine or TPS_DEV=1.';
  }
  return undefined;
}

const schema = z.object({
  TPS_DEV: z.enum(['0', '1'], { error: () => 'TPS_DEV must be 1, or unset.' }).optional(),
  TPS_OTEL_ENDPOINT: z.string().optional(),
  TPS_OTEL_HEADERS: z
    .string()
    .max(MAX_HEADERS_LENGTH, 'TPS_OTEL_HEADERS is too long.')
    .refine(
      (text) => parseHeaders(text) !== undefined,
      'TPS_OTEL_HEADERS must be Name=value pairs separated by commas.',
    )
    .optional(),
  TPS_OTEL_ENVIRONMENT: z
    .string()
    .regex(ENVIRONMENT, 'TPS_OTEL_ENVIRONMENT must be lower-case letters, digits and hyphens.')
    .optional(),
});

export function loadTelemetrySettings(
  env: Env,
  readFile?: (path: string) => string,
): TelemetrySettings {
  const problems = new Map<string, string>();
  const raw: Record<string, string | undefined> = {};
  for (const name of ['TPS_DEV', 'TPS_OTEL_ENDPOINT', 'TPS_OTEL_ENVIRONMENT']) {
    raw[name] = env[name] === '' ? undefined : env[name];
  }
  if ((env['TPS_OTEL_HEADERS'] ?? '') !== '' || (env['TPS_OTEL_HEADERS_FILE'] ?? '') !== '') {
    try {
      raw['TPS_OTEL_HEADERS'] = readSecret(env, 'TPS_OTEL_HEADERS', readFile);
    } catch (error) {
      problems.set(
        'TPS_OTEL_HEADERS',
        error instanceof Error ? error.message : 'Set TPS_OTEL_HEADERS or TPS_OTEL_HEADERS_FILE.',
      );
    }
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0]);
      if (!problems.has(name)) problems.set(name, issue.message);
    }
  }
  const endpoint = raw['TPS_OTEL_ENDPOINT'];
  const problem =
    endpoint === undefined ? undefined : endpointProblem(endpoint, raw['TPS_DEV'] === '1');
  if (problem !== undefined) problems.set('TPS_OTEL_ENDPOINT', problem);
  if (endpoint === undefined && raw['TPS_OTEL_HEADERS'] !== undefined) {
    problems.set('TPS_OTEL_HEADERS', 'TPS_OTEL_HEADERS is used only with TPS_OTEL_ENDPOINT.');
  }
  if (problems.size > 0 || !result.success) throw new ConfigError([...problems.values()]);
  const headers = result.data.TPS_OTEL_HEADERS;
  const development = result.data.TPS_DEV === '1';

  return {
    ...(endpoint === undefined ? {} : { endpoint: new URL(endpoint) }),
    ...(headers === undefined ? {} : { headers: new Secret(headers) }),
    environment: result.data.TPS_OTEL_ENVIRONMENT ?? (development ? 'development' : 'production'),
  };
}
