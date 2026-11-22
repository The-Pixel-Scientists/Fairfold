// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's server handlers against the test database as app_api, each call in
// its own tenant transaction like a request, with a second tenant to prove
// isolation. Names, emails and identifiers are invented and recognisable, so
// a test can look for them in audit events and answers. The platform's own
// checks (permission, step-up, module switch) run before a handler and are
// tested with the API; here the handlers are called as it calls them.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { attempt } from '../../../../packages/db/src/savepoint.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { noteRow, referenceRow, eventRow } from '../../../../packages/db/test/crm/fixtures.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  registerRepoints,
  type RepointParty,
  type RepointResult,
} from '@pixel-scientists/party/contracts';
import { createPartyMerges, partyRepoint } from '@pixel-scientists/party/server';

import { segmentFields } from '../contracts/index.ts';
import type { CrmContext, CrmDependencies, Tx } from './context.ts';
import { crmHandlers } from './index.ts';
import { crmRepoint } from './repoint.ts';
import { testPartyReads } from './test-support/party-reads.ts';

// Each request opens its own transactions and a busy machine is slow.
vi.setConfig({ testTimeout: 60_000 });

const NAME = 'Quillfeather';
const KEY = randomBytes(32);
const NOW = 1_800_000_000;

interface Event {
  readonly read: boolean;
  readonly action: string;
  readonly entityId: string;
  readonly subjectPartyId?: string;
  readonly changes?: unknown;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: TestTenant;
let b: TestTenant;
let memberA: string;
let memberB: string;

const inTenant = <T>(tenant: TestTenant, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(tenant.id), work);

const refusal = (status: number) => (detail: string) =>
  Object.assign(new Error(detail), { status });

/** A stand-in for another module's re-point. */
function stub(
  module: 'grants' | 'assure' | 'forms' | 'privacy' | 'insight',
  repoint: RepointParty<Tx>['repoint'] = () => Promise.resolve({ ok: true, rows: [] }),
): RepointParty<Tx> {
  return {
    module,
    repoint,
    restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
  };
}

function handlersWith(extra: RepointParty<Tx>[] = [], now = NOW) {
  const others = extra.map(({ module }) => module);
  const fillers = (['grants', 'assure', 'forms', 'privacy', 'insight'] as const)
    .filter((module) => !others.includes(module as never))
    .map((module) => stub(module));
  const deps: CrmDependencies = {
    notFound: () => new Error('Not found'),
    refuse: (status, detail) => refusal(status)(detail),
    parties: testPartyReads,
    merges: createPartyMerges({
      repoints: registerRepoints([partyRepoint, crmRepoint, ...extra, ...fillers]),
      notFound: () => new Error('Not found'),
    }),
    attempt: (tx, work) => attempt(tx, work),
    signPreview: (text) => createHmac('sha256', KEY).update(text).digest('base64url'),
    digest: (text) => createHash('sha256').update(text).digest('hex'),
    now: () => now,
  };
  return crmHandlers(deps);
}

const handlers = handlersWith();

function request(tenant: TestTenant, member: string) {
  const events: Event[] = [];
  const configs: { type: string; id: string; diff: unknown }[] = [];
  const context: CrmContext = {
    audit: {
      record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
      read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
    },
    config: {
      record: (type, id, diff) => Promise.resolve(void configs.push({ type, id, diff })),
    },
    session: {
      userId: randomUUID(),
      tenant: tenant.id,
      email: () => Promise.resolve('staff@example.test'),
    },
    membership: { id: member },
  };
  return { events, configs, context };
}

/** Runs `work` as one request of `member` in `tenant`. */
const asStaff = <T>(
  tenant: TestTenant,
  member: string,
  work: (r: ReturnType<typeof request> & { tx: Tx }) => Promise<T>,
) => inTenant(tenant, (tx) => work({ tx, ...request(tenant, member) }));
const asA = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(a, memberA, work);
const asB = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(b, memberB, work);

const org = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant, change));
const person = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, change));
const insert = (tenant: TestTenant, table: string, row: Record<string, unknown>) =>
  asMigratorIn(tenant.id, (client) => insertRow(client, table, row));
const query = <T extends object>(tenant: TestTenant, sql: string, values: unknown[] = []) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(sql, values)).rows);
const identifier = (tenant: TestTenant, organisationId: string, value: string) =>
  insert(tenant, 'party.organisation_identifier', {
    tenant_id: tenant.id,
    organisation_id: organisationId,
    scheme: 'GB-CHC',
    identifier: value,
  });

const rejection = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error('Expected the call to fail.');
};

const statusOf = async (tenant: TestTenant, id: string) =>
  (await query<{ status: string }>(tenant, 'SELECT status FROM party.party WHERE id = $1', [id]))[0]
    ?.status;
const countOf = async (tenant: TestTenant, table: string) =>
  Number((await query<{ n: string }>(tenant, `SELECT count(*) AS n FROM ${table}`))[0]?.n);

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(a.id, (client) => addMember(client, a));
  memberB = await asMigratorIn(b.id, (client) => addMember(client, b));
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('search', () => {
  it('finds by name and email, audits each person with that person as the subject, and never repeats the term', async () => {
    const [harbour, ada] = [
      await org(a, { name: `${NAME} Gardens` }),
      await person(a, { given_name: 'Zephyrine', family_name: NAME, email: 'zq@example.test' }),
    ];
    await org(b, { name: `${NAME} Gardens Elsewhere` });

    const { page, events } = await asA(async ({ tx, context, events }) => ({
      events,
      page: await handlers.searchParties({
        tx,
        context,
        input: { body: { term: NAME.toUpperCase(), limit: 25 } },
      }),
    }));

    expect(page.results.map(({ id }) => id).sort()).toEqual([harbour, ada].sort());
    expect(page.results.find(({ id }) => id === harbour)).toMatchObject({
      kind: 'organisation',
      status: 'active',
      verification: 'none',
    });
    expect(events).toEqual([
      { read: true, action: 'crm.party.found', entityId: ada, subjectPartyId: ada },
    ]);
    expect(JSON.stringify(events)).not.toContain(NAME);
  });

  it('pages without repeating a result', async () => {
    const [x, y] = [
      await org(a, { name: `Pagewell ${NAME} A` }),
      await org(a, { name: `Pagewell ${NAME} B` }),
    ];
    const first = await asA(({ tx, context }) =>
      handlers.searchParties({ tx, context, input: { body: { term: 'Pagewell', limit: 1 } } }),
    );
    expect(first.results).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await asA(({ tx, context }) =>
      handlers.searchParties({
        tx,
        context,
        input: {
          body: {
            term: 'Pagewell',
            limit: 1,
            ...(first.nextCursor && { cursor: first.nextCursor }),
          },
        },
      }),
    );
    expect([first.results[0]?.id, second.results[0]?.id].sort()).toEqual([x, y].sort());
    expect(second.nextCursor).toBeNull();
  });

  it('refuses a cursor that is not one of its own, without echoing it', async () => {
    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.searchParties({
          tx,
          context,
          input: { body: { term: NAME, limit: 5, cursor: 'bm90LWEtbnVtYmVy' } },
        }),
      ),
    );
    expect(error).toMatchObject({ status: 400 });
    expect(error.message).not.toContain('bm90LWEtbnVtYmVy');
  });
});

describe('detail', () => {
  it('reads party’s record with crm’s lists, references and timeline, and audits the view', async () => {
    const harbour = await org(a, { name: 'Detail Harbour' });
    const list = await asA(({ tx, context }) =>
      handlers.createList({
        tx,
        context,
        input: { body: { name: `Detail list ${randomUUID()}` } },
      }),
    );
    await asA(({ tx, context }) =>
      handlers.addMembers({
        tx,
        context,
        input: { params: { listId: list.id }, body: { partyIds: [harbour] } },
      }),
    );
    await insert(a, 'crm.external_reference', referenceRow(a, harbour, memberA));
    await insert(a, 'crm.interaction', noteRow(a, harbour, memberA));

    const { record, events } = await asA(async ({ tx, context, events }) => ({
      events,
      record: await handlers.getOrganisationRecord({
        tx,
        context,
        input: { params: { organisationId: harbour } },
      }),
    }));

    expect(record).toMatchObject({
      state: 'current',
      organisation: { name: 'Detail Harbour' },
      lists: [{ id: list.id }],
      timeline: { interactions: 1 },
    });
    expect(events).toContainEqual(
      expect.objectContaining({ action: 'crm.party.viewed', subjectPartyId: harbour }),
    );
    const asPerson = await rejection(
      asA(({ tx, context }) =>
        handlers.getPersonRecord({ tx, context, input: { params: { personId: harbour } } }),
      ),
    );
    expect(asPerson.message).toBe('Not found');
  });

  it('reads another tenant’s party as not found', async () => {
    const theirs = await org(b, { name: 'Detail Elsewhere' });
    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.getOrganisationRecord({
          tx,
          context,
          input: { params: { organisationId: theirs } },
        }),
      ),
    );
    expect(error.message).toBe('Not found');
  });
});

describe('duplicates', () => {
  it('lists a pair once with its signal and band, and no value that matched', async () => {
    const [x, y] = [
      await org(a, { name: 'Firstwell Trust' }),
      await org(a, { name: 'Another Name Entirely' }),
    ];
    await identifier(a, x, '1000021');
    await identifier(a, y, '1000021');
    const other = await org(b, { name: 'Firstwell Trust' });
    await identifier(b, other, '1000021');
    await identifier(b, await org(b), '1000021');

    const { one, all } = await asA(async ({ tx, context }) => ({
      one: await handlers.listPartyDuplicates({ tx, context, input: { params: { partyId: x } } }),
      all: await handlers.listDuplicates({
        tx,
        context,
        input: { body: { kind: 'organisation' } },
      }),
    }));

    const pair = { kind: 'organisation', signals: ['claimed_identifier'], band: 'medium' };
    const [partyId, otherPartyId] = x < y ? [x, y] : [y, x];
    expect(one.pairs).toEqual([{ partyId, otherPartyId, ...pair }]);
    expect(all.pairs.filter((p) => p.partyId === partyId)).toEqual([
      { partyId, otherPartyId, ...pair },
    ]);
    expect(JSON.stringify([one, all])).not.toMatch(/1000021|Firstwell/);
  });

  it('answers another tenant’s party as not found', async () => {
    const theirs = await org(b);
    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.listPartyDuplicates({ tx, context, input: { params: { partyId: theirs } } }),
      ),
    );
    expect(error.message).toBe('Not found');
  });
});

describe('merge', () => {
  const merge = (loserId: string, survivorId: string, kind: 'organisation' | 'person') => ({
    loserId,
    survivorId,
    kind,
  });

  async function preview(loser: string, survivor: string, h = handlers) {
    return asA(async ({ tx, context, events }) => ({
      events,
      preview: await h.previewMerge({
        tx,
        context,
        input: { body: merge(loser, survivor, 'organisation') },
      }),
    }));
  }

  it('previews without changing anything, then merges as previewed in one transaction with one record', async () => {
    const [loser, survivor] = [
      await org(a, { name: `Mergeloser ${NAME}` }),
      await org(a, { name: `Mergesurvivor ${NAME}` }),
    ];
    const list = await asA(({ tx, context }) =>
      handlers.createList({ tx, context, input: { body: { name: `Merge list ${randomUUID()}` } } }),
    );
    await asA(({ tx, context }) =>
      handlers.addMembers({
        tx,
        context,
        input: { params: { listId: list.id }, body: { partyIds: [loser] } },
      }),
    );
    await insert(a, 'crm.interaction', noteRow(a, loser, memberA));
    await insert(a, 'crm.external_reference', referenceRow(a, loser, memberA));

    const { preview: shown, events: previewed } = await preview(loser, survivor);
    expect(shown.conflicts).toEqual([]);
    expect(shown.counts).toEqual({
      crm: { 'crm.list_member': 1, 'crm.interaction': 1, 'crm.external_reference': 1 },
    });
    expect(await statusOf(a, loser)).toBe('active');
    expect(await countOf(a, 'crm.merge_record')).toBe(0);
    expect(previewed.map((e) => e.action)).toEqual(['crm.merge.previewed', 'crm.merge.previewed']);

    const { record, events } = await asA(async ({ tx, context, events }) => ({
      events,
      record: await handlers.confirmMerge({
        tx,
        context,
        input: {
          body: { ...merge(loser, survivor, 'organisation'), carryOver: [], token: shown.token },
        },
      }),
    }));

    expect(record).toMatchObject({
      kind: 'merge',
      partyKind: 'organisation',
      loserId: loser,
      survivorId: survivor,
      decidedBy: memberA,
      counts: shown.counts,
    });
    expect(await statusOf(a, loser)).toBe('merged');
    expect(
      await query(a, 'SELECT party_id FROM crm.list_member WHERE list_id = $1', [list.id]),
    ).toEqual([{ party_id: survivor }]);
    expect(await countOf(a, 'crm.merge_record')).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({ action: 'party.party.merged', entityId: loser }),
      expect.objectContaining({
        action: 'crm.merge.confirmed',
        entityId: record.id,
        subjectPartyId: loser,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(NAME);
    const found = await asA(({ tx, context }) =>
      handlers.searchParties({
        tx,
        context,
        input: { body: { term: 'Mergeloser', statuses: ['merged'], limit: 5 } },
      }),
    );
    expect(found.results).toEqual([
      expect.objectContaining({ id: survivor, status: 'merged', kind: 'organisation' }),
    ]);
    const stored = await asA(({ tx, context }) =>
      handlers.getMergeRecord({ tx, context, input: { params: { mergeRecordId: record.id } } }),
    );
    expect(stored).toEqual(record);
  });

  it('refuses a token made for other state, an old one, and a made-up one, writing nothing', async () => {
    const [loser, survivor] = [await org(a), await org(a)];
    const before = await countOf(a, 'crm.merge_record');
    const { preview: shown } = await preview(loser, survivor);
    await insert(a, 'crm.interaction', noteRow(a, loser, memberA));
    const confirm = (token: string, h = handlers) =>
      asA(({ tx, context }) =>
        h.confirmMerge({
          tx,
          context,
          input: { body: { ...merge(loser, survivor, 'organisation'), carryOver: [], token } },
        }),
      );

    expect(await rejection(confirm(shown.token))).toMatchObject({ status: 409 });
    const fresh = (await preview(loser, survivor)).preview;
    expect(await rejection(confirm(fresh.token, handlersWith([], NOW + 301)))).toMatchObject({
      status: 409,
    });
    expect(await rejection(confirm(`${NOW}.${'A'.repeat(43)}`))).toMatchObject({ status: 409 });
    expect(await statusOf(a, loser)).toBe('active');
    expect(await countOf(a, 'crm.merge_record')).toBe(before);
  });

  it('refuses the conflicts party names before any write, and a carry-over party cannot honour', async () => {
    const x = await org(a);
    const accounts = [await person(a), await person(a)];
    for (const id of accounts) {
      await query(a, 'UPDATE party.person SET user_id = $2 WHERE id = $1', [
        id,
        await createTestUser(),
      ]);
    }
    const { preview: self } = await preview(x, x);
    expect(self.conflicts).toEqual(['self_merge']);
    const people = await asA(({ tx, context }) =>
      handlers.previewMerge({
        tx,
        context,
        input: { body: merge(accounts[0] ?? '', accounts[1] ?? '', 'person') },
      }),
    );
    expect(people.conflicts).toEqual(['both_have_accounts']);
    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.confirmMerge({
          tx,
          context,
          input: {
            body: {
              ...merge(accounts[0] ?? '', accounts[1] ?? '', 'person'),
              carryOver: [randomUUID()],
              token: people.token,
            },
          },
        }),
      ),
    );
    expect(error).toMatchObject({ status: 400 });
  });

  it('undoes the whole merge when a module fails or the record cannot be written', async () => {
    const [loser, survivor] = [await org(a), await org(a)];
    const before = await countOf(a, 'crm.merge_record');
    await insert(a, 'crm.interaction', noteRow(a, loser, memberA));
    const failing = [
      stub('grants', () => Promise.reject(new Error('Synthetic failure'))),
      stub('grants', () =>
        Promise.resolve<RepointResult>({
          ok: true,
          rows: [{ table: 'NOT A TABLE', rowId: randomUUID(), change: 'repointed' }],
        }),
      ),
    ];
    for (const grants of failing) {
      const h = handlersWith([grants]);
      const { preview: shown } = await asA(async ({ tx, context }) => ({
        preview: await h
          .previewMerge({ tx, context, input: { body: merge(loser, survivor, 'organisation') } })
          .catch(() => null),
      }));
      const token = shown?.token ?? `${NOW}.${'A'.repeat(43)}`;
      await rejection(
        asA(({ tx, context }) =>
          h.confirmMerge({
            tx,
            context,
            input: { body: { ...merge(loser, survivor, 'organisation'), carryOver: [], token } },
          }),
        ),
      );
      expect(await statusOf(a, loser)).toBe('active');
      expect(
        await query(a, 'SELECT party_id FROM crm.interaction WHERE party_id = $1', [loser]),
      ).toHaveLength(1);
    }
    expect(await countOf(a, 'crm.merge_record')).toBe(before);
  });

  it('answers another tenant’s ids as not found and writes nothing', async () => {
    const [x, y] = [await org(b), await org(b)];
    const before = await countOf(a, 'crm.merge_record');
    const error = await rejection(preview(x, y));
    expect(error.message).toBe('Not found');
    expect(await statusOf(b, x)).toBe('active');
    expect(await countOf(a, 'crm.merge_record')).toBe(before);
    const mine = await org(a);
    expect((await rejection(preview(mine, y))).message).toBe('Not found');
  });
});

describe('crm re-point', () => {
  it('moves crm rows with crm switched off, keeps one list membership and leaves a duplicate event where it is', async () => {
    await query(
      a,
      "INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by) VALUES ($1, 'crm', false, $2) ON CONFLICT DO NOTHING",
      [a.id, memberA],
    );
    const [loser, survivor] = [await person(a), await person(a)];
    const list = await asA(({ tx, context }) =>
      handlers.createList({
        tx,
        context,
        input: { body: { name: `Repoint list ${randomUUID()}` } },
      }),
    );
    await asA(({ tx, context }) =>
      handlers.addMembers({
        tx,
        context,
        input: { params: { listId: list.id }, body: { partyIds: [loser, survivor] } },
      }),
    );
    const alone = await asA(({ tx, context }) =>
      handlers.createList({
        tx,
        context,
        input: { body: { name: `Repoint alone ${randomUUID()}` } },
      }),
    );
    await asA(({ tx, context }) =>
      handlers.addMembers({
        tx,
        context,
        input: { params: { listId: alone.id }, body: { partyIds: [loser] } },
      }),
    );
    const application = randomUUID();
    const shared = { source_entity_id: application };
    await insert(a, 'crm.interaction', eventRow(a, loser, shared));
    await insert(a, 'crm.interaction', eventRow(a, survivor, shared));
    await insert(a, 'crm.interaction', noteRow(a, loser, memberA));
    const record = await insert(a, 'crm.merge_record', {
      tenant_id: a.id,
      kind: 'person',
      action: 'merge',
      loser_id: loser,
      survivor_id: survivor,
      repointed_counts: '{}',
      preview_hash: 'b'.repeat(64),
      merged_by: memberA,
    });

    const result = await inTenant(a, (tx) =>
      crmRepoint.repoint(tx, { loserId: loser, survivorId: survivor, kind: 'person' }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.rows.map((r) => r.table).sort()).toEqual([
      'crm.interaction',
      'crm.list_member',
    ]);
    expect(
      await query(a, 'SELECT party_id FROM crm.list_member WHERE list_id = $1', [list.id]),
    ).toEqual([{ party_id: survivor }]);
    expect(
      await query(a, 'SELECT party_id FROM crm.list_member WHERE list_id = $1', [alone.id]),
    ).toEqual([{ party_id: survivor }]);
    expect(
      await query(a, 'SELECT party_id FROM crm.interaction WHERE party_id = $1', [loser]),
    ).toHaveLength(1);
    expect(await query(a, 'SELECT loser_id FROM crm.merge_record WHERE id = $1', [record])).toEqual(
      [{ loser_id: loser }],
    );
  });
});

describe('lists', () => {
  it('creates, renames, archives and refuses a repeated name without echoing it', async () => {
    const name = `Quill list ${randomUUID()}`;
    const { list, events, configs } = await asA(async ({ tx, context, events, configs }) => ({
      events,
      configs,
      list: await handlers.createList({
        tx,
        context,
        input: { body: { name, description: 'For tests' } },
      }),
    }));
    expect(list).toMatchObject({ name, members: 0, archivedAt: null });
    expect(configs).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({ action: 'crm.list.created', entityId: list.id }),
    ]);

    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.createList({ tx, context, input: { body: { name: name.toUpperCase() } } }),
      ),
    );
    expect(error).toMatchObject({ status: 409 });
    expect(error.message).not.toContain(name.toUpperCase());

    const renamed = await asA(({ tx, context }) =>
      handlers.updateList({
        tx,
        context,
        input: { params: { listId: list.id }, body: { name: `${name} renamed` } },
      }),
    );
    expect(renamed.name).toBe(`${name} renamed`);
    const done = await asA(({ tx, context }) =>
      handlers.archiveList({ tx, context, input: { params: { listId: list.id } } }),
    );
    expect(done.archivedAt).not.toBeNull();
    expect(
      await rejection(
        asA(({ tx, context }) =>
          handlers.updateList({
            tx,
            context,
            input: { params: { listId: list.id }, body: { name: 'Again' } },
          }),
        ),
      ),
    ).toMatchObject({ status: 409 });
  });

  it('adds and removes members by party id, audits each with its subject, and refuses another tenant’s id', async () => {
    const [mine, also, theirs] = [await person(a), await org(a), await person(b)];
    const list = await asA(({ tx, context }) =>
      handlers.createList({ tx, context, input: { body: { name: `Members ${randomUUID()}` } } }),
    );
    const change = (partyIds: string[]) => ({ params: { listId: list.id }, body: { partyIds } });

    const added = await asA(async ({ tx, context, events }) => ({
      events,
      result: await handlers.addMembers({ tx, context, input: change([mine, also]) }),
    }));
    expect(added.result).toEqual({ changed: 2, unchanged: 0 });
    expect(added.events.map((e) => [e.action, e.subjectPartyId]).sort()).toEqual(
      [
        ['crm.list_member.added', mine],
        ['crm.list_member.added', also],
      ].sort(),
    );
    expect(
      await asA(({ tx, context }) => handlers.addMembers({ tx, context, input: change([mine]) })),
    ).toEqual({ changed: 0, unchanged: 1 });

    const before = await countOf(a, 'crm.list_member');
    const error = await rejection(
      asA(({ tx, context }) => handlers.addMembers({ tx, context, input: change([also, theirs]) })),
    );
    expect(error.message).toBe('Not found');
    expect(await countOf(a, 'crm.list_member')).toBe(before);

    const page = await asA(({ tx, context }) =>
      handlers.listMembers({ tx, context, input: { params: { listId: list.id }, query: {} } }),
    );
    expect(page.members.map((m) => m.partyId).sort()).toEqual([mine, also].sort());
    expect(
      await asA(({ tx, context }) =>
        handlers.removeMembers({ tx, context, input: change([mine]) }),
      ),
    ).toEqual({ changed: 1, unchanged: 0 });
  });

  it('reads another tenant’s list as not found', async () => {
    const theirs = await asB(({ tx, context }) =>
      handlers.createList({ tx, context, input: { body: { name: `Theirs ${randomUUID()}` } } }),
    );
    const works: ((r: { tx: Tx; context: CrmContext }) => Promise<unknown>)[] = [
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.archiveList({ tx, context, input: { params: { listId: theirs.id } } }),
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.listMembers({ tx, context, input: { params: { listId: theirs.id }, query: {} } }),
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.addMembers({
          tx,
          context,
          input: { params: { listId: theirs.id }, body: { partyIds: [randomUUID()] } },
        }),
    ];
    for (const work of works) {
      expect((await rejection(asA(work))).message).toBe('Not found');
    }
    expect(
      (
        await asB(({ tx, context }) => handlers.listLists({ tx, context, input: { query: {} } }))
      ).lists.map((l) => l.id),
    ).toContain(theirs.id);
    expect(
      (
        await asA(({ tx, context }) => handlers.listLists({ tx, context, input: { query: {} } }))
      ).lists.map((l) => l.id),
    ).not.toContain(theirs.id);
  });
});

describe('segments', () => {
  const filter = (field: string, operator: string, value: string) => ({
    [randomUUID()]: { field, operator, value },
  });

  it('saves with version 1, raises it by one with a config version and audit event, and keeps values out of both', async () => {
    const name = `Segment ${randomUUID()}`;
    const created = await asA(async ({ tx, context, events, configs }) => ({
      events,
      configs,
      segment: await handlers.createSegment({
        tx,
        context,
        input: { body: { name, filters: filter('kind', 'eq', 'person') } },
      }),
    }));
    expect(created.segment).toMatchObject({ version: 1, name });
    expect(created.configs).toMatchObject([{ type: 'crm.segment', id: created.segment.id }]);
    expect(created.events).toEqual([
      expect.objectContaining({ action: 'crm.segment.saved', entityId: created.segment.id }),
    ]);

    const same = await asA(async ({ tx, context, events, configs }) => ({
      events,
      configs,
      segment: await handlers.updateSegment({
        tx,
        context,
        input: {
          params: { segmentId: created.segment.id },
          body: { name, filters: created.segment.filters },
        },
      }),
    }));
    expect(same).toMatchObject({ segment: { version: 1 }, events: [], configs: [] });

    const changed = await asA(async ({ tx, context, configs }) => ({
      configs,
      segment: await handlers.updateSegment({
        tx,
        context,
        input: {
          params: { segmentId: created.segment.id },
          body: { name, filters: filter('status', 'eq', 'archived') },
        },
      }),
    }));
    expect(changed.segment.version).toBe(2);
    expect(JSON.stringify(changed.configs)).not.toContain('archived"');
  });

  it('refuses a field outside the allowlist, and a repeated name without echoing it', async () => {
    const name = `Allowlist ${randomUUID()}`;
    await expect(
      asA(({ tx, context }) =>
        handlers.createSegment({
          tx,
          context,
          input: { body: { name, filters: filter('email', 'eq', 'a@example.test') } },
        }),
      ),
    ).rejects.toThrow();
    await asA(({ tx, context }) =>
      handlers.createSegment({
        tx,
        context,
        input: { body: { name, filters: filter('kind', 'eq', 'person') } },
      }),
    );
    const error = await rejection(
      asA(({ tx, context }) =>
        handlers.createSegment({
          tx,
          context,
          input: { body: { name, filters: filter('kind', 'eq', 'person') } },
        }),
      ),
    );
    expect(error).toMatchObject({ status: 409 });
    expect(error.message).not.toContain(name);
  });

  it('runs every field and operator on the allowlist as a parameterised statement, and pages audited members', async () => {
    const sample: Record<string, string> = {
      kind: 'person',
      status: 'active',
      legal_form: 'registered_charity',
      identifier_scheme: 'GB-CHC',
      list: randomUUID(),
      contact_for: randomUUID(),
      interaction_kind: 'note',
      last_interaction: '2026-01-01',
      created: '2026-01-01',
    };
    const people = [await person(a), await person(a)];
    for (const [field, { operators }] of Object.entries(segmentFields)) {
      for (const operator of operators) {
        const segment = await asA(({ tx, context }) =>
          handlers.createSegment({
            tx,
            context,
            input: {
              body: {
                name: `All ${field} ${operator} ${randomUUID()}`,
                filters: filter(field, operator, sample[field] ?? ''),
              },
            },
          }),
        );
        const page = await asA(({ tx, context }) =>
          handlers.segmentMembers({
            tx,
            context,
            input: { params: { segmentId: segment.id }, query: {} },
          }),
        );
        expect(page.members.length).toBeGreaterThanOrEqual(0);
      }
    }
    const kinds = await asA(async ({ tx, context, events }) => {
      const segment = await handlers.createSegment({
        tx,
        context,
        input: {
          body: { name: `People ${randomUUID()}`, filters: filter('kind', 'eq', 'person') },
        },
      });
      const page = await handlers.segmentMembers({
        tx,
        context,
        input: { params: { segmentId: segment.id }, query: {} },
      });
      return { page, events };
    });
    expect(kinds.page.members.map((m) => m.partyId)).toEqual(expect.arrayContaining(people));
    expect(kinds.events.filter((e) => e.action === 'crm.party.found').length).toBe(
      kinds.page.members.length,
    );
  });

  it('answers party and crm filters together, and pages them by cursor', async () => {
    const tenant = await createTestTenant();
    const member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    const everyone = await asMigratorIn(tenant.id, async (client) => {
      const ids: string[] = [];
      for (let n = 0; n < 55; n += 1) ids.push(await addPerson(client, tenant));
      return ids;
    });
    const called = everyone.slice(0, 3);
    for (const id of called) await insert(tenant, 'crm.interaction', noteRow(tenant, id, member));
    const create = (filters: ReturnType<typeof filter>) =>
      asStaff(tenant, member, ({ tx, context }) =>
        handlers.createSegment({ tx, context, input: { body: { name: randomUUID(), filters } } }),
      );
    const read = (segmentId: string, cursor?: string) =>
      asStaff(tenant, member, ({ tx, context }) =>
        handlers.segmentMembers({
          tx,
          context,
          input: { params: { segmentId }, query: cursor === undefined ? {} : { cursor } },
        }),
      );

    const calledSegment = await create({
      ...filter('kind', 'eq', 'person'),
      ...filter('interaction_kind', 'has', 'call'),
    });
    expect((await read(calledSegment.id)).members.map((m) => m.partyId).sort()).toEqual(
      called.sort(),
    );

    const rest = await create({
      ...filter('kind', 'eq', 'person'),
      ...filter('interaction_kind', 'lacks', 'call'),
    });
    const first = await read(rest.id);
    expect(first.members).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await read(rest.id, first.nextCursor ?? '');
    expect(second.nextCursor).toBeNull();
    expect([...first.members, ...second.members].map((m) => m.partyId).sort()).toEqual(
      everyone.filter((id) => !called.includes(id)).sort(),
    );
    expect((await rejection(read(rest.id, 'not-a-cursor'))).message).toMatch(/page link/);
  });

  it('reads another tenant’s segment as not found', async () => {
    const theirs = await asB(({ tx, context }) =>
      handlers.createSegment({
        tx,
        context,
        input: {
          body: { name: `Theirs ${randomUUID()}`, filters: filter('kind', 'eq', 'person') },
        },
      }),
    );
    const works: ((r: { tx: Tx; context: CrmContext }) => Promise<unknown>)[] = [
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.getSegment({ tx, context, input: { params: { segmentId: theirs.id } } }),
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.archiveSegment({ tx, context, input: { params: { segmentId: theirs.id } } }),
      ({ tx, context }: { tx: Tx; context: CrmContext }) =>
        handlers.segmentMembers({
          tx,
          context,
          input: { params: { segmentId: theirs.id }, query: {} },
        }),
    ];
    for (const work of works) {
      expect((await rejection(asA(work))).message).toBe('Not found');
    }
  });
});
