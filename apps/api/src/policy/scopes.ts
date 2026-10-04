// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scope rules (ADR 0004): which records a caller who holds a route's
// permission may reach. The domain package names the rules; the module that
// owns each registers its resolver by id, and the API will not start with a
// route whose rule has none.

import type { ScopeRule } from '@pixel-scientists/domain/platform';

import type { TenantTransaction } from '../database.ts';

/** The parsed request, for a resolver to read the ids it needs from. */
export interface ScopeInput {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}

export interface ScopeCheck {
  readonly tx: TenantTransaction;
  readonly userId: string;
  readonly membershipId: string;
  readonly input: ScopeInput;
}

/**
 * Whether the caller may reach what the request addresses. False answers 404,
 * exactly as a record that does not exist does, so a caller learns nothing
 * about another person's records. A route that lists records applies its
 * filter in the handler and has nothing to refuse here.
 */
export type ScopeResolver = (check: ScopeCheck) => Promise<boolean>;

export type ScopeResolvers = Readonly<Partial<Record<ScopeRule, ScopeResolver>>>;

/** Any record in the session's tenant; row-level security keeps every query inside it. */
const tenant: ScopeResolver = () => Promise.resolve(true);

export function withTenantScope(modules: ScopeResolvers): ScopeResolvers {
  if (Object.hasOwn(modules, 'tenant')) {
    throw new Error('The tenant scope rule belongs to the platform; modules do not register it.');
  }
  return { ...modules, tenant };
}
