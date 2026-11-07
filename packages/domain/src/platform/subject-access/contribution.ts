// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each module's `server` exports, beside its warehouse contribution, so
// that subject access and erasure reach every table that holds a person's
// data (ADR 0016, ADR 0027). The platform calls every registered module's,
// including a module switched off for the tenant, since it keeps its data.
// Each runs in the caller's transaction, which carries the tenant: no
// contribution takes a tenant id.

import type { ModuleId } from '../modules.ts';
import type { ErasureCounts } from './erasure.ts';
import type { SubjectData } from './schemas.ts';

/**
 * Yields the party's rows in each table the module owns, every value with its
 * field's sensitivity: columns from the classification map, reached through
 * its subject paths, and form answers by stable field id with the class the
 * pinned form version gives them.
 */
export interface SubjectDataContribution<M extends ModuleId, Tx> {
  readonly module: M;
  readonly subjectData: (tx: Tx, subjectPartyId: string) => Promise<SubjectData>;
}

/**
 * A party being erased: one of the named party's merge set, with the values
 * the engine read through the party contract as they stood, for matching
 * rows that hold no party id. The values stay in memory: never written to a
 * table, job, log, audit event or result. They are null for an organisation.
 */
export interface ErasureSubject {
  readonly partyId: string;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly email: string | null;
  /** The person's account (`auth.user` id), for rows keyed by account. */
  readonly accountId: string | null;
}

/**
 * Anonymises the subjects' personal data in the module's own schema, in
 * place, through the module's approved functions, and never deletes a party
 * another row refers to. It answers how many rows of each table it changed
 * and nothing else; any other result rolls the whole erasure back.
 */
export interface ErasureContribution<M extends ModuleId, Tx> {
  readonly module: M;
  readonly erase: (tx: Tx, subjects: readonly ErasureSubject[]) => Promise<ErasureCounts>;
}
