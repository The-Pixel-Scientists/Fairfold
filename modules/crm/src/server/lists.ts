// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lists (ADR 0033): named sets of organisations and people that staff keep
// by hand. A member is a party id and nothing more: no consent, channel or
// contact value is stored, and nothing here sends. Ids are checked against
// party in the caller's tenant before anything is written, so an id from
// another tenant reads as not found. Each change writes its audit event with
// ids only, and a member's event names that party as the subject.

import type { List, ListInput, ListUpdate, MemberChange } from '../contracts/index.ts';
import {
  crmDb,
  iso,
  isTaken,
  nextCursor,
  PAGE,
  readCursor,
  type Args,
  type CrmDb,
  type CrmDependencies,
  type Tx,
} from './context.ts';

const nameTaken = 'A list with this name already exists. Choose a different name.';
const archived = 'This list is archived. Restore it by creating a new list.';

/** Parties a list may hold: not merged away, and not erased. */
const OPEN: readonly string[] = ['active', 'archived'];

const listColumns = (db: CrmDb) =>
  db
    .selectFrom('crm.list as l')
    .select((eb) => [
      'l.id',
      'l.name',
      'l.description',
      'l.archived_at',
      'l.updated_at',
      eb
        .selectFrom('crm.list_member as m')
        .select(eb.fn.countAll<string>().as('count'))
        .whereRef('m.list_id', '=', 'l.id')
        .as('members'),
    ]);

type Row = Awaited<ReturnType<ReturnType<typeof listColumns>['executeTakeFirstOrThrow']>>;

const toList = (row: Row): List => ({
  id: row.id,
  name: row.name,
  description: row.description,
  members: Number(row.members),
  archivedAt: row.archived_at === null ? null : iso(row.archived_at),
  updatedAt: iso(row.updated_at),
});

export function listHandlers(deps: CrmDependencies) {
  async function readList(db: CrmDb, id: string): Promise<List> {
    const row = await listColumns(db).where('l.id', '=', id).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toList(row);
  }

  async function listLists({
    tx,
    input,
  }: Args<{ query: { cursor?: string | undefined } }>): Promise<{
    lists: List[];
    nextCursor: string | null;
  }> {
    const offset = readCursor(input.query.cursor, deps);
    const rows = await listColumns(crmDb(tx))
      .orderBy((eb) => eb.case().when('l.archived_at', 'is', null).then(0).else(1).end())
      .orderBy((eb) => eb.fn<string>('lower', [eb.ref('l.name')]))
      .orderBy('l.id')
      .limit(PAGE + 1)
      .offset(offset)
      .execute();
    return { lists: rows.slice(0, PAGE).map(toList), nextCursor: nextCursor(offset, rows.length) };
  }

  async function createList({ tx, context, input }: Args<{ body: ListInput }>): Promise<List> {
    const db = crmDb(tx);
    const { name, description } = input.body;
    let id: string;
    try {
      ({ id } = await db
        .insertInto('crm.list')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          name,
          description: description || null,
          created_by: context.membership.id,
          updated_by: context.membership.id,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, nameTaken) : error;
    }
    await context.audit.record({
      action: 'crm.list.created',
      entityId: id,
      changes: { 'crm.list.name': {}, 'crm.list.description': {} },
    });
    return readList(db, id);
  }

  async function updateList({
    tx,
    context,
    input,
  }: Args<{ params: { listId: string }; body: ListUpdate }>): Promise<List> {
    const { listId } = input.params;
    const { name, description } = input.body;
    const db = crmDb(tx);
    const current = await db
      .selectFrom('crm.list')
      .select('archived_at')
      .where('id', '=', listId)
      .forUpdate()
      .executeTakeFirst();
    if (current === undefined) throw deps.notFound();
    if (current.archived_at !== null) throw deps.refuse(409, archived);
    if (name === undefined && description === undefined) return readList(db, listId);
    try {
      await db
        .updateTable('crm.list')
        .set({
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description: description || null }),
          updated_by: context.membership.id,
        })
        .where('id', '=', listId)
        .execute();
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, nameTaken) : error;
    }
    await context.audit.record({
      action: 'crm.list.updated',
      entityId: listId,
      changes: {
        ...(name === undefined ? {} : { 'crm.list.name': {} }),
        ...(description === undefined ? {} : { 'crm.list.description': {} }),
      },
    });
    return readList(db, listId);
  }

  async function archiveList({
    tx,
    context,
    input,
  }: Args<{ params: { listId: string } }>): Promise<List> {
    const { listId } = input.params;
    const db = crmDb(tx);
    const list = await readList(db, listId);
    if (list.archivedAt !== null) return list;
    await db
      .updateTable('crm.list')
      .set({ archived_at: new Date(), updated_by: context.membership.id })
      .where('id', '=', listId)
      .execute();
    await context.audit.record({
      action: 'crm.list.archived',
      entityId: listId,
      changes: { 'crm.list.archived_at': {} },
    });
    return readList(db, listId);
  }

  async function listMembers({
    tx,
    input,
  }: Args<{ params: { listId: string }; query: { cursor?: string | undefined } }>) {
    const { listId } = input.params;
    const db = crmDb(tx);
    await readList(db, listId);
    const offset = readCursor(input.query.cursor, deps);
    const rows = await db
      .selectFrom('crm.list_member')
      .select(['party_id', 'created_at'])
      .where('list_id', '=', listId)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(PAGE + 1)
      .offset(offset)
      .execute();
    const page = rows.slice(0, PAGE);
    const kinds = new Map(
      (
        await deps.parties.facts(
          tx,
          page.map((row) => row.party_id),
        )
      ).map((party) => [party.id, party.kind]),
    );
    return {
      members: page.flatMap((row) => {
        const kind = kinds.get(row.party_id);
        return kind === undefined
          ? []
          : [{ partyId: row.party_id, kind, addedAt: iso(row.created_at) }];
      }),
      nextCursor: nextCursor(offset, rows.length),
    };
  }

  /** The list, open to change: missing is not found, archived is refused. */
  async function openList(db: CrmDb, listId: string): Promise<void> {
    const list = await db
      .selectFrom('crm.list')
      .select('archived_at')
      .where('id', '=', listId)
      .forShare()
      .executeTakeFirst();
    if (list === undefined) throw deps.notFound();
    if (list.archived_at !== null) throw deps.refuse(409, archived);
  }

  async function addMembers({
    tx,
    context,
    input,
  }: Args<{ params: { listId: string }; body: MemberChange }>) {
    const { listId } = input.params;
    const { partyIds } = input.body;
    const db = crmDb(tx);
    await openList(db, listId);
    const here = (await deps.parties.facts(tx, partyIds)).filter(({ status }) =>
      OPEN.includes(status),
    );
    if (here.length !== partyIds.length) throw deps.notFound();
    const added = await db
      .insertInto('crm.list_member')
      .values((eb) =>
        partyIds.map((partyId) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          list_id: listId,
          party_id: partyId,
          added_by: context.membership.id,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .returning('party_id')
      .execute();
    for (const { party_id } of added) {
      await context.audit.record({
        action: 'crm.list_member.added',
        entityId: listId,
        subjectPartyId: party_id,
      });
    }
    return { changed: added.length, unchanged: partyIds.length - added.length };
  }

  async function removeMembers({
    tx,
    context,
    input,
  }: Args<{ params: { listId: string }; body: MemberChange }>) {
    const { listId } = input.params;
    const { partyIds } = input.body;
    const db = crmDb(tx);
    await openList(db, listId);
    const removed = await db
      .deleteFrom('crm.list_member')
      .where('list_id', '=', listId)
      .where('party_id', 'in', partyIds)
      .returning('party_id')
      .execute();
    for (const { party_id } of removed) {
      await context.audit.record({
        action: 'crm.list_member.removed',
        entityId: listId,
        subjectPartyId: party_id,
      });
    }
    return { changed: removed.length, unchanged: partyIds.length - removed.length };
  }

  /** What a replay of `createList` answers: the list as it reads now. */
  const replayList = ({ tx, id }: { tx: Tx; id: string }): Promise<List> => readList(crmDb(tx), id);

  return {
    listLists,
    createList,
    updateList,
    archiveList,
    listMembers,
    addMembers,
    removeMembers,
    replayList,
  };
}
