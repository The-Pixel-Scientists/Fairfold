// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The key that hashes the limits' counter keys (ADR 0028), from
// TPS_REQUEST_LIMIT_KEY or TPS_REQUEST_LIMIT_KEY_FILE. It must be at least
// 32 bytes and not a development value. Only with TPS_DEV=1 may it be left
// out: the process then makes a key of its own, which other instances do not
// share.

import { randomBytes } from 'node:crypto';

import { readSecret, type Env } from '@pixel-scientists/db';

import { ConfigError, Secret } from '../config.ts';

const NAME = 'TPS_REQUEST_LIMIT_KEY';
const MINIMUM_BYTES = 32;

/** The fixed development values in infra/compose/compose.dev.yaml all end like this. */
const DEVELOPMENT_VALUE = /not-a-secret$/;

export interface LimitSettings {
  readonly key: Secret;
}

export function loadLimitSettings(env: Env): LimitSettings {
  const development = env['TPS_DEV'] === '1';
  if (env[NAME] === undefined && env[`${NAME}_FILE`] === undefined && development) {
    return { key: new Secret(randomBytes(MINIMUM_BYTES).toString('hex')) };
  }
  let key: string;
  try {
    key = readSecret(env, NAME);
  } catch (error) {
    throw new ConfigError([error instanceof Error ? error.message : `Set ${NAME}.`]);
  }
  if (Buffer.byteLength(key) < MINIMUM_BYTES) {
    throw new ConfigError([`${NAME} must be at least ${String(MINIMUM_BYTES)} bytes.`]);
  }
  if (DEVELOPMENT_VALUE.test(key) && !development) {
    throw new ConfigError([`${NAME} is a development value, which works only with TPS_DEV=1.`]);
  }
  return { key: new Secret(key) };
}
