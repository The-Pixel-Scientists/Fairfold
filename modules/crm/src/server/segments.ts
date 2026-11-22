// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Segments (architecture rule 10): saved filters whose members are worked
// out when read. A segment is configuration, so every change raises its
// version by exactly one and writes the matching `crm.segment` config version
// and `crm.segment.saved` in the same transaction, with a diff of field ids
// and operators and never a value. A filter's field is on the contract's
// closed list of fields, none personal, special category or hidden; each
// field and operator maps to a fixed statement with the value as a
// parameter, and no filter is ever turned into SQL text. Filters on a party's
// own columns are answered by party's scan; crm answers its own (lists and
// interactions) for each batch party returns.

import type { PartyKind } from '@pixel-scientists/party/contracts';

import {
  segmentDiff,
  segmentInputSchema,
  type Segment,
  type SegmentFilter,
  type SegmentInput,
} from '../contracts/index.ts';
import {
  crmDb,
  idCursor,
  iso,
  isRefusedByRule,
  isTaken,
  nextCursor,
  PAGE,
  readCursor,
  readIdCursor,
  type Args,
  type CrmDb,
  type CrmDependencies,
} from './context.ts';
import { isPartyFilter } from './parties.ts';

const nameTaken = 'A segment with this name already exists. Choose a different name.';
const changed = 'This segment was changed by someone else. Reload it and try again.';
const archived = 'This segment is archived. Create a new segment to use its filters again.';

const filtersSchema = segmentInputSchema.shape.filters;

/** The day after a date, as text, so that "after" means a later day. */
const nextDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Parties read from party in one go while a page of members is worked out. */
const BATCH = 200;

/** The parties among `ids` that satisfy a filter on crm's own tables. */
async function crmMatches(
  db: CrmDb,
  ids: readonly string[],
  { field, operator, value }: SegmentFilter,
): Promise<Set<string>> {
  switch (field) {
    case 'list':
    case 'interaction_kind': {
      const rows =
        field === 'list'
          ? await db
              .selectFrom('crm.list_member')
              .select('party_id')
              .where('party_id', 'in', ids)
              .where('list_id', '=', value)
              .execute()
          : await db
              .selectFrom('crm.interaction')
              .select('party_id')
              .where('party_id', 'in', ids)
              .where('kind', '=', value)
              .execute();
      const held = new Set(rows.map((row) => row.party_id));
      return operator === 'ne' || operator === 'lacks'
        ? new Set(ids.filter((id) => !held.has(id)))
        : held;
    }
    case 'last_interaction': {
      const [bound, test] =
        operator === 'before' ? ([value, '<'] as const) : ([nextDay(value), '>='] as const);
      const rows = await db
        .selectFrom('crm.interaction')
        .select('party_id')
        .where('party_id', 'in', ids)
        .groupBy('party_id')
        .having((eb) =>
          eb(eb.fn.max('occurred_at'), test, eb.cast<Date>(eb.val(bound), 'timestamptz')),
        )
        .execute();
      return new Set(rows.map((row) => row.party_id));
    }
    default:
      throw new Error('A filter on a party field is answered by party.');
  }
}

/** The audit event's changes: each field id the diff touched, with no value. */
function auditChanges(diff: readonly { path: string }[]) {
  const ids = diff.map(({ path }) =>
    path === 'name' || path === 'description' ? `crm.segment.${path}` : 'crm.segment.definition',
  );
  return Object.fromEntries([...new Set(ids)].map((id) => [id, {}]));
}

export function segmentHandlers(deps: CrmDependencies) {
  const columns = (db: CrmDb) =>
    db
      .selectFrom('crm.segment')
      .select(['id', 'name', 'description', 'definition', 'version', 'archived_at', 'updated_at']);

  type Row = Awaited<ReturnType<ReturnType<typeof columns>['executeTakeFirstOrThrow']>>;

  const summary = (row: Row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    archivedAt: row.archived_at === null ? null : iso(row.archived_at),
    updatedAt: iso(row.updated_at),
  });

  const toSegment = (row: Row): Segment => ({
    ...summary(row),
    filters: filtersSchema.parse(row.definition),
  });

  async function readSegment(db: CrmDb, id: string, lock = false): Promise<Row> {
    const query = columns(db).where('id', '=', id);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return row;
  }

  async function listSegments({ tx, input }: Args<{ query: { cursor?: string | undefined } }>) {
    const offset = readCursor(input.query.cursor, deps);
    const rows = await columns(crmDb(tx))
      .orderBy((eb) => eb.case().when('archived_at', 'is', null).then(0).else(1).end())
      .orderBy((eb) => eb.fn<string>('lower', [eb.ref('name')]))
      .orderBy('id')
      .limit(PAGE + 1)
      .offset(offset)
      .execute();
    return {
      segments: rows.slice(0, PAGE).map(summary),
      nextCursor: nextCursor(offset, rows.length),
    };
  }

  async function getSegment({
    tx,
    input,
  }: Args<{ params: { segmentId: string } }>): Promise<Segment> {
    return toSegment(await readSegment(crmDb(tx), input.params.segmentId));
  }

  async function createSegment({
    tx,
    context,
    input,
  }: Args<{ body: SegmentInput }>): Promise<Segment> {
    const db = crmDb(tx);
    const { name, description, filters } = segmentInputSchema.parse(input.body);
    let id: string;
    try {
      ({ id } = await db
        .insertInto('crm.segment')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          name,
          description: description || null,
          definition: filters,
          created_by: context.membership.id,
          updated_by: context.membership.id,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, nameTaken) : error;
    }
    const diff = segmentDiff(null, { name, description, filters });
    await context.config.record('crm.segment', id, diff);
    await context.audit.record({
      action: 'crm.segment.saved',
      entityId: id,
      changes: auditChanges(diff),
    });
    return toSegment(await readSegment(db, id));
  }

  async function updateSegment({
    tx,
    context,
    input,
  }: Args<{ params: { segmentId: string }; body: SegmentInput }>): Promise<Segment> {
    const { segmentId } = input.params;
    const db = crmDb(tx);
    const after = segmentInputSchema.parse(input.body);
    const row = await readSegment(db, segmentId, true);
    if (row.archived_at !== null) throw deps.refuse(409, archived);
    const before = {
      name: row.name,
      description: row.description ?? '',
      filters: filtersSchema.parse(row.definition),
    };
    const diff = segmentDiff(before, after);
    if (diff.length === 0) return toSegment(row);
    try {
      const saved = await db
        .updateTable('crm.segment')
        .set({
          name: after.name,
          description: after.description || null,
          definition: after.filters,
          version: row.version + 1,
          updated_by: context.membership.id,
        })
        .where('id', '=', segmentId)
        .where('version', '=', row.version)
        .returning('id')
        .executeTakeFirst();
      if (saved === undefined) throw deps.refuse(409, changed);
    } catch (error) {
      if (isTaken(error)) throw deps.refuse(409, nameTaken);
      throw isRefusedByRule(error) ? deps.refuse(409, changed) : error;
    }
    await context.config.record('crm.segment', segmentId, diff);
    await context.audit.record({
      action: 'crm.segment.saved',
      entityId: segmentId,
      changes: auditChanges(diff),
    });
    return toSegment(await readSegment(db, segmentId));
  }

  async function archiveSegment({
    tx,
    context,
    input,
  }: Args<{ params: { segmentId: string } }>): Promise<Segment> {
    const { segmentId } = input.params;
    const db = crmDb(tx);
    const row = await readSegment(db, segmentId);
    if (row.archived_at !== null) return toSegment(row);
    await db
      .updateTable('crm.segment')
      .set({ archived_at: new Date(), updated_by: context.membership.id })
      .where('id', '=', segmentId)
      .execute();
    await context.audit.record({
      action: 'crm.segment.archived',
      entityId: segmentId,
      changes: { 'crm.segment.archived_at': {} },
    });
    return toSegment(await readSegment(db, segmentId));
  }

  async function segmentMembers({
    tx,
    context,
    input,
  }: Args<{ params: { segmentId: string }; query: { cursor?: string | undefined } }>) {
    const db = crmDb(tx);
    const { filters } = toSegment(await readSegment(db, input.params.segmentId));
    const all = Object.values(filters);
    const [mine, theirs] = [all.filter(isPartyFilter), all.filter((f) => !isPartyFilter(f))];
    let after = readIdCursor(input.query.cursor, deps);
    const found: { id: string; kind: PartyKind }[] = [];
    for (let more = true; more && found.length <= PAGE;) {
      const batch = await deps.parties.scan(tx, { filters: mine, afterId: after, limit: BATCH });
      more = batch.length === BATCH;
      after = batch.at(-1)?.id;
      let keep: ReadonlySet<string> = new Set(batch.map(({ id }) => id));
      for (const filter of theirs) {
        if (keep.size === 0) break;
        const matched = await crmMatches(db, [...keep], filter);
        keep = new Set([...keep].filter((id) => matched.has(id)));
      }
      found.push(...batch.filter(({ id }) => keep.has(id)));
    }
    const page = found.slice(0, PAGE);
    const last = page.at(-1);
    for (const { id } of page.filter(({ kind }) => kind === 'person')) {
      await context.audit.read({ action: 'crm.party.found', entityId: id, subjectPartyId: id });
    }
    return {
      members: page.map(({ id, kind }) => ({ partyId: id, kind })),
      nextCursor: found.length > PAGE && last !== undefined ? idCursor(last.id) : null,
    };
  }

  return {
    listSegments,
    getSegment,
    createSegment,
    updateSegment,
    archiveSegment,
    segmentMembers,
  };
}
