// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each adapter needs to reach its register and to finish a lookup. No
// database, tenant, request or audit writer is involved, so the lookup
// widget can use the adapters alone.

import { identifierSchemes } from '@pixel-scientists/party/contracts';

import {
  registries,
  registryResultSchema,
  type LookupOutcome,
  type Registry,
  type RegistryResult,
} from '../../contracts/index.ts';
import type { Fetched } from './http.ts';

export interface Transport {
  /** A GET to a fixed address with the headers given; every outcome is a code. */
  readonly get: (url: string, headers: Readonly<Record<string, string>>) => Promise<Fetched>;
  readonly now: () => Date;
}

/** Whether `identifier` is in the register's format, so it is safe to put in a path. */
export const isIdentifier = (registry: Registry, identifier: string): boolean =>
  identifierSchemes[registries[registry]].pattern.test(identifier);

/** The result, checked against the contract's strict schema before anything is written. */
export function finish(result: Omit<RegistryResult, 'fetchedAt'>, at: Date): LookupOutcome {
  const parsed = registryResultSchema.safeParse({ ...result, fetchedAt: at.toISOString() });
  return parsed.success
    ? { ok: true, result: parsed.data }
    : { ok: false, failure: 'response_refused' };
}

export const refused: LookupOutcome = { ok: false, failure: 'response_refused' };
