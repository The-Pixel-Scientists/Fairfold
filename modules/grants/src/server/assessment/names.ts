// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Members by name, from their person records through party's contract. A
// member with no person record, or a record with no name, has none.

import { peopleByUserIds } from '@pixel-scientists/party/server';

import type { ReviewerRef } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { assessmentDb } from './tables.ts';

/** Each member's name, by membership id. */
export async function namesOf(
  tx: Tx,
  membershipIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const ids = [...new Set(membershipIds)];
  if (ids.length === 0) return new Map();
  const members = await assessmentDb(tx)
    .selectFrom('app.membership')
    .select(['id', 'user_id'])
    .where('id', 'in', ids)
    .execute();
  const people = await peopleByUserIds(
    tx,
    members.map((member) => member.user_id),
  );
  return new Map(
    members.map((member) => {
      const person = people.get(member.user_id);
      const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
      return [member.id, name === '' ? null : name];
    }),
  );
}

/** Members as the contracts name them, ordered by name (those without one last), then id. */
export async function reviewerRefs(tx: Tx, membershipIds: readonly string[]) {
  const names = await namesOf(tx, membershipIds);
  const refs = membershipIds.map((membershipId): ReviewerRef => ({
    membershipId,
    name: names.get(membershipId) ?? null,
  }));
  return refs.sort(
    (a, b) =>
      Number(a.name === null) - Number(b.name === null) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.membershipId.localeCompare(b.membershipId),
  );
}
