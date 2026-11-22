// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which signature provider the cell uses (ADR 0040), read once at start-up by
// the API and the worker. The provider is chosen by the operator's
// configuration, never by a tenant. The fake provider exists for development
// and tests: it signs with a key anyone can read, so a process that is not in
// development mode refuses to start with it selected.

import type { Env } from '@pixel-scientists/db';

import { ConfigError } from '../../../config.ts';
import { developmentOnly, providerKeys, type ProviderKey } from './registry.ts';

export interface EsignSettings {
  /** The adapter this cell uses, or null while signing is not set up. */
  readonly provider: ProviderKey | null;
}

export function loadEsignSettings(env: Env): EsignSettings {
  const value = env['TPS_ESIGN_PROVIDER'] ?? '';
  if (value === '') return { provider: null };
  const provider = providerKeys.find((key) => key === value);
  if (provider === undefined) {
    throw new ConfigError([`TPS_ESIGN_PROVIDER must be one of: ${providerKeys.join(', ')}.`]);
  }
  if (developmentOnly.includes(provider) && env['TPS_DEV'] !== '1') {
    throw new ConfigError([
      `TPS_ESIGN_PROVIDER=${provider} works only with TPS_DEV=1. Choose a real provider.`,
    ]);
  }
  return { provider };
}
