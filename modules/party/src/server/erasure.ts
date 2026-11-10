// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's contribution to erasure (ADR 0016, ADR 0027). It
// anonymises each party of the person's merge set in place through
// party.erase_party(), the approved function, and changes nothing itself.
// The function acts only for a running erasure request of the tenant that
// names the party, which is found in the caller's transaction; it keeps the
// `party.party` row, and an erased party answers zero counts. Counts are by
// table and never hold a value.

import type {
  ErasureContribution,
  ErasureCounts,
  ErasureSubject,
} from '@pixel-scientists/domain/platform/subject-access';

import { partyMergeSet } from './subject-data.ts';
import type { Tx } from './tables.ts';

type Tables = Record<string, Record<string, unknown>>;

/** The party a request names, as the engine and the request check need it. */
export interface ErasureTarget {
  readonly kind: 'person' | 'organisation';
  readonly erased: boolean;
  /** Every party of the merge set, with a person's values as they stand: for matching only, never stored. */
  readonly subjects: readonly ErasureSubject[];
}

/** The named party and its merge set, or null if the transaction's tenant has no such party. */
export async function partyErasureTarget(tx: Tx, partyId: string): Promise<ErasureTarget | null> {
  const db = tx.$extendTables<Tables>();
  const named = await db
    .selectFrom('party.party')
    .select(['kind', 'status'])
    .where('id', '=', partyId)
    .executeTakeFirst();
  if (!named) return null;
  const ids = await partyMergeSet(tx, partyId);
  const people = await db
    .selectFrom('party.person')
    .select(['id', 'given_name', 'family_name', 'email', 'user_id'])
    .where('id', 'in', ids)
    .execute();
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const subjects = ids.map((id): ErasureSubject => {
    const person = people.find((row) => row['id'] === id);
    return {
      partyId: id,
      givenName: text(person?.['given_name']),
      familyName: text(person?.['family_name']),
      email: text(person?.['email']),
      accountId: text(person?.['user_id']),
    };
  });
  return {
    kind: named['kind'] === 'person' ? 'person' : 'organisation',
    erased: named['status'] === 'erased',
    subjects,
  };
}

/**
 * The running erasure request that names one of these parties: the handle the
 * approved erasure functions of every module ask for.
 */
export async function runningErasureRequest(tx: Tx, partyIds: readonly string[]): Promise<string> {
  const running = await tx
    .$extendTables<Tables>()
    .selectFrom('app.job_request')
    .select(['id', 'filters'])
    .where('kind', '=', 'erasure')
    .where('status', '=', 'running')
    .orderBy('requested_at')
    .execute();
  const named = running.find(({ filters }) =>
    partyIds.includes(String((filters as { partyId?: unknown } | null)?.partyId)),
  );
  if (!named) throw new Error('Erasure needs a running erasure request for the party.');
  return String(named['id']);
}

export const partyErasure: ErasureContribution<'party', Tx> = {
  module: 'party',
  async erase(tx, subjects) {
    const requestId = await runningErasureRequest(
      tx,
      subjects.map(({ partyId }) => partyId),
    );
    const total: Record<string, number> = {};
    for (const { partyId } of subjects) {
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb
            .fn<ErasureCounts>('party.erase_party', [eb.val(partyId), eb.val(requestId)])
            .as('counts'),
        )
        .executeTakeFirstOrThrow();
      for (const [table, count] of Object.entries(counts)) {
        total[table] = (total[table] ?? 0) + count;
      }
    }
    return total;
  },
};
