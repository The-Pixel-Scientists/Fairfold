// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading settings from the environment, shared by the API, the worker and
// the database scripts. There are no default credentials: a missing value is
// an error naming the variable.

import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';

export type Env = Readonly<Record<string, string | undefined>>;

/** Read a required, non-secret setting. */
export function readSetting(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Set ${name}.`);
  }
  return value;
}

/**
 * Read a secret from NAME, or from the file named by NAME_FILE (a mounted
 * Compose or Kubernetes secret), without the file's final newline. Setting
 * both is an error, so it is always clear which one is in use.
 */
export function readSecret(env: Env, name: string, readFile = readTextFile): string {
  const value = env[name];
  const file = env[`${name}_FILE`];
  if (value && file) {
    throw new Error(`Set ${name} or ${name}_FILE, not both.`);
  }
  let secret = value;
  if (file) {
    try {
      secret = readFile(file).replace(/\r?\n$/, '');
    } catch {
      // The reason can name paths on the host, so say only which variable failed.
      throw new Error(`${name}_FILE names a file that cannot be read.`);
    }
  }
  if (!secret) {
    throw new Error(`Set ${name} or ${name}_FILE.`);
  }
  return secret;
}

function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Whether a host is this machine: localhost, an address in 127.0.0.0/8, or
 * ::1. Development-only behaviour, and connecting without TLS by default,
 * refuse any other host.
 */
export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return isIPv4(host) && host.startsWith('127.');
}
