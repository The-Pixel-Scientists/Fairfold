// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The registry adapters (ADR 0031), built once from the deployment's keys.
// A register with no key has no adapter: its lookups end as "not set up".
// OSCR and CCNI are read from the register downloads that S12-26 loads, so
// they have none here yet. Every call goes out through the global fetch,
// which the dispatcher governs (ADR 0010); this file holds no database
// handle, tenant or audit writer.

import type { Registry, RegistryAdapter } from '../../contracts/index.ts';
import { charityCommission } from './charity-commission.ts';
import { companiesHouse } from './companies-house.ts';
import { getJson, type Fetcher } from './http.ts';
import { allowance } from './limiter.ts';
import type { Secret } from './secret.ts';
import type { Transport } from './transport.ts';

/** One key per register per deployment (ADR 0031); a missing key leaves the register off. */
export interface RegistryKeys {
  readonly charityCommission?: Secret | undefined;
  readonly companiesHouse?: Secret | undefined;
}

export type RegistryAdapters = Readonly<Partial<Record<Registry, RegistryAdapter>>>;

export interface AdapterOptions {
  /** The global fetch, looked up on each call so the dispatcher installed at start applies. */
  readonly fetch?: Fetcher;
  readonly now?: () => Date;
}

/** ADR 0031: at most 5 requests a second to the Charity Commission, and 500 in 5 minutes to Companies House. */
const LIMITS = { charity_commission: [5, 1_000], companies_house: [500, 300_000] } as const;

function transportFor(registry: keyof typeof LIMITS, options: AdapterOptions): Transport {
  const [max, windowMs] = LIMITS[registry];
  const allow = allowance(max, windowMs, () => (options.now ?? (() => new Date()))().getTime());
  return {
    get: (url, headers) =>
      allow()
        ? getJson(options.fetch ?? ((...args) => globalThis.fetch(...args)), url, headers)
        : Promise.resolve({ ok: false, failure: 'rate_limited' }),
    now: options.now ?? (() => new Date()),
  };
}

export function createRegistryAdapters(
  keys: RegistryKeys,
  options: AdapterOptions = {},
): RegistryAdapters {
  return {
    ...(keys.charityCommission && {
      charity_commission: charityCommission(
        keys.charityCommission,
        transportFor('charity_commission', options),
      ),
    }),
    ...(keys.companiesHouse && {
      companies_house: companiesHouse(
        keys.companiesHouse,
        transportFor('companies_house', options),
      ),
    }),
  };
}
