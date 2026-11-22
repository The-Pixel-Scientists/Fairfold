// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The registry keys, read once at start-up (ADR 0005, ADR 0031). Each key is
// a secret read as `NAME` or `NAME_FILE`. A key that is not set leaves its
// register off; one that is set badly (both forms, or a file that cannot be
// read) stops start-up with a message that names the variable, never the
// value. ADR 0031 has not yet confirmed the registers' terms (GK), so no
// key is set in any deployment until it is amended.

import { readSecret, type Env } from '@pixel-scientists/db';

import { registryIds, type Registry } from '../../contracts/index.ts';
import type { RegistryAdapters, RegistryKeys } from './adapters.ts';
import { Secret } from './secret.ts';

export const CHARITY_COMMISSION_KEY = 'TPS_CHARITY_COMMISSION_API_KEY';
export const COMPANIES_HOUSE_KEY = 'TPS_COMPANIES_HOUSE_API_KEY';

function optionalKey(env: Env, name: string): Secret | undefined {
  return !env[name] && !env[`${name}_FILE`] ? undefined : new Secret(readSecret(env, name));
}

export function readRegistryKeys(env: Env): RegistryKeys {
  return {
    charityCommission: optionalKey(env, CHARITY_COMMISSION_KEY),
    companiesHouse: optionalKey(env, COMPANIES_HOUSE_KEY),
  };
}

/** The registers this deployment cannot reach, for the start-up report: names only. */
export const registersOff = (adapters: RegistryAdapters): readonly Registry[] =>
  registryIds.filter((registry) => adapters[registry] === undefined);
