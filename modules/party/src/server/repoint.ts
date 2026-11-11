// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Party's own part of a merge (ADR 0025), run in the merge's transaction like
// every module's: parties already merged into the loser follow it to the
// survivor, the loser's links are ended or carried over, and its identifiers
// and their verification move to the survivor. It checks before it writes, so
// a conflict leaves nothing changed. Consent, value history and snapshots
// keep the ids they were written with; no app role may change a row's party
// columns, so a link is ended and added, and an identifier is added to the
// survivor, instead of being moved. The deciding member is passed in, since
// the contract's re-point has no member: the executor calls `repointParty`.

import { permissionsFor } from '@pixel-scientists/domain/platform';

import type {
  MergeConflict,
  PartyKind,
  RepointParty,
  RepointResult,
  RepointRow,
} from '../contracts/index.ts';
import { writeHistory } from './history.ts';
import { partyDb, type PartyDb, type Tx } from './tables.ts';

const row = (table: string, rowId: string, change: RepointRow['change']): RepointRow => ({
  table,
  rowId,
  change,
});

/** Both people linked to accounts, or only the loser: an account link never moves. */
async function accountConflict(
  db: PartyDb,
  loserId: string,
  survivorId: string,
): Promise<MergeConflict | null> {
  const people = await db
    .selectFrom('party.person')
    .select(['id', 'user_id'])
    .where('id', 'in', [loserId, survivorId])
    .execute();
  const loser = people.find((person) => person.id === loserId)?.user_id;
  const survivor = people.find((person) => person.id === survivorId)?.user_id;
  if (loser && survivor) return 'both_have_accounts';
  return loser ? 'account_on_loser' : null;
}

/**
 * The same scheme with different values may not be verified on the loser, and a
 * verification moves only while its verifier is still active staff: setting it
 * on the survivor's row would otherwise raise in the database and fail the
 * merge, and the time it keeps cannot be the verifier's.
 */
async function identifierConflict(
  db: PartyDb,
  loserId: string,
  survivorId: string,
): Promise<MergeConflict | null> {
  const held = await db
    .selectFrom('party.organisation_identifier')
    .select(['organisation_id', 'scheme', 'identifier', 'verified_by'])
    .where('organisation_id', 'in', [loserId, survivorId])
    .execute();
  for (const mine of held.filter((item) => item.organisation_id === loserId)) {
    const theirs = held.find(
      (item) => item.organisation_id === survivorId && item.scheme === mine.scheme,
    );
    if (theirs === undefined || theirs.identifier === mine.identifier) continue;
    if (mine.verified_by !== null) {
      return theirs.verified_by === null
        ? 'loser_identifier_verified'
        : 'identifiers_both_verified';
    }
  }
  const verifiers = held
    .filter((item) => item.organisation_id === loserId && item.verified_by !== null)
    .map((item) => item.verified_by as string);
  if (verifiers.length === 0) return null;
  const members = await db
    .selectFrom('app.membership')
    .select(['id', 'status', 'roles'])
    .where('id', 'in', verifiers)
    .execute();
  const active = new Set(
    members
      .filter(
        (member) =>
          member.status === 'active' && permissionsFor(member.roles, 'console').length > 0,
      )
      .map((member) => member.id),
  );
  return verifiers.every((id) => active.has(id)) ? null : 'module_refused';
}

/** End links on the merge date. The link is kept. */
async function endLinks(db: PartyDb, links: readonly string[]): Promise<RepointRow[]> {
  if (links.length === 0) return [];
  const ended = await db
    .updateTable('party.relationship')
    // The merge date, or the start if that is later, which the table's date check needs.
    .set((eb) => ({
      ends_on: eb.fn<string>('greatest', [eb.cast(eb.fn('now', []), 'date'), eb.ref('starts_on')]),
    }))
    .where('id', 'in', links)
    .returning('id')
    .execute();
  return ended.map(({ id }) => row('party.relationship', id, 'link_ended'));
}

/**
 * A person's current links end, and carry over to the survivor only when
 * neither has an account, so that no account gains an organisation through a
 * merge. A link the survivor has already is ended and not added twice.
 */
async function personLinks(db: PartyDb, loserId: string, survivorId: string) {
  const links = await db
    .selectFrom('party.relationship')
    .select(['id', 'object_id'])
    .where('subject_id', '=', loserId)
    .where('ends_on', 'is', null)
    .execute();
  const rows = await endLinks(
    db,
    links.map(({ id }) => id),
  );
  const account = await db
    .selectFrom('party.person')
    .select('user_id')
    .where('id', '=', survivorId)
    .executeTakeFirst();
  if (account?.user_id) return rows;
  for (const { object_id } of links) {
    const has = await db
      .selectFrom('party.relationship')
      .select('id')
      .where('subject_id', '=', survivorId)
      .where('object_id', '=', object_id)
      .where('ends_on', 'is', null)
      .executeTakeFirst();
    if (has !== undefined) continue;
    const added = await db
      .insertInto('party.relationship')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        type: 'contact_for',
        subject_id: survivorId,
        subject_kind: 'person',
        object_id,
        object_kind: 'organisation',
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    rows.push(row('party.relationship', added.id, 'link_added'));
  }
  return rows;
}

/** The loser's contacts are not carried over: each would gain the survivor's records. */
async function organisationLinks(db: PartyDb, loserId: string) {
  const links = await db
    .selectFrom('party.relationship')
    .select('id')
    .where('object_id', '=', loserId)
    .where('ends_on', 'is', null)
    .execute();
  return endLinks(
    db,
    links.map(({ id }) => id),
  );
}

/**
 * A scheme only the loser holds is added to the survivor, and a verification
 * moves to the survivor's row: cleared on the loser's first, so the
 * verified-once index never sees two. The same scheme with a different value
 * stays on the loser as a claim.
 */
async function moveIdentifiers(
  db: PartyDb,
  loserId: string,
  survivorId: string,
  decidedBy: string,
) {
  const held = await db
    .selectFrom('party.organisation_identifier')
    .select(['id', 'organisation_id', 'scheme', 'identifier', 'verified_by'])
    .where('organisation_id', 'in', [loserId, survivorId])
    .execute();
  const rows: RepointRow[] = [];
  for (const mine of held.filter((item) => item.organisation_id === loserId)) {
    const theirs = held.find(
      (item) => item.organisation_id === survivorId && item.scheme === mine.scheme,
    );
    if (theirs !== undefined && theirs.identifier !== mine.identifier) continue;
    let target = theirs?.id;
    if (target === undefined) {
      const added = await db
        .insertInto('party.organisation_identifier')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          organisation_id: survivorId,
          scheme: mine.scheme,
          identifier: mine.identifier,
          created_by: decidedBy,
          updated_by: decidedBy,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      target = added.id;
      rows.push(row('party.organisation_identifier', target, 'link_added'));
      await writeHistory(db, { id: survivorId, kind: 'organisation' }, decidedBy, [
        {
          field: 'organisation.identifier',
          before: null,
          after: `${mine.scheme}-${mine.identifier}`,
        },
      ]);
    }
    if (mine.verified_by !== null && (theirs?.verified_by ?? null) === null) {
      await db
        .updateTable('party.organisation_identifier')
        .set({ verified_by: null })
        .where('id', '=', mine.id)
        .execute();
      await db
        .updateTable('party.organisation_identifier')
        .set({ verified_by: mine.verified_by })
        .where('id', '=', target)
        .execute();
      rows.push(row('party.organisation_identifier', target, 'verification_moved'));
    }
  }
  return rows;
}

/** Party's side of a merge, decided by the member `decidedBy`. */
export async function repointParty(
  tx: Tx,
  { loserId, survivorId, kind }: { loserId: string; survivorId: string; kind: PartyKind },
  decidedBy: string,
): Promise<RepointResult> {
  const db = partyDb(tx);
  const conflict =
    kind === 'person'
      ? await accountConflict(db, loserId, survivorId)
      : await identifierConflict(db, loserId, survivorId);
  if (conflict !== null) return { ok: false, conflict };

  const followed = await db
    .updateTable('party.party')
    .set({ merged_into: survivorId })
    .where('merged_into', '=', loserId)
    .where('status', '=', 'merged')
    .returning('id')
    .execute();
  const rows = followed.map(({ id }) => row('party.party', id, 'merged_into_moved'));
  if (kind === 'person') {
    rows.push(...(await personLinks(db, loserId, survivorId)));
  } else {
    rows.push(...(await organisationLinks(db, loserId)));
    rows.push(...(await moveIdentifiers(db, loserId, survivorId, decidedBy)));
  }
  return { ok: true, rows };
}

/**
 * Party's entry in the registry. The executor runs party's side through
 * `repointParty`, which names the deciding member, so this one refuses a call
 * without it. An unmerge is not built yet, so a restore always refuses.
 */
export const partyRepoint: RepointParty<Tx> = {
  module: 'party',
  repoint: () =>
    Promise.reject(new Error("Party's re-point runs in the merge, which names the member.")),
  restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
};
