// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's timeline against the test database: the read and manual routes as
// app_api, each call in its own tenant transaction like a request, and the
// two event handlers as app_worker, with a second tenant to prove isolation.
// Names and summaries are invented and recognisable, so a test can look for
// them in audit events and in the timeline's references.

import { randomUUID } from 'node:crypto';

import { parseEvent } from '@pixel-scientists/domain/events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { attempt } from '../../../../../packages/db/src/savepoint.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { eventRow, noteRow, SUMMARY } from '../../../../../packages/db/test/crm/fixtures.ts';
import {
  addReleased,
  addSubmission,
  decisionRow,
  type Submission,
} from '../../../../../packages/db/test/grants/decision-fixtures.ts';
import { addOrganisation, addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { CrmContext, CrmDependencies, Tx } from '../context.ts';
import { testGrantsReads, testResolveParty } from '../test-support/imports.ts';
import { testPartyReads } from '../test-support/party-reads.ts';
import { timelineEvents } from './events.ts';
import { timelineHandlers } from './read.ts';

// Each request opens its own transactions and a busy machine is slow.
vi.setConfig({ testTimeout: 60_000 });

type Db = ReturnType<typeof createDatabase<unknown>>;

interface Event {
  readonly read: boolean;
  readonly action: string;
  readonly entityId: string;
  readonly subjectPartyId?: string;
  readonly changes?: Record<string, unknown>;
}

let api: Db;
let worker: Db;
let a: TestTenant;
let b: TestTenant;
let c: TestTenant;
let d: TestTenant;
let memberA: string;
let memberB: string;

const crmDeps = {
  notFound: () => new Error('Not found'),
  refuse: (status: number, detail: string) => Object.assign(new Error(detail), { status }),
  parties: testPartyReads,
} as unknown as CrmDependencies;

const handlers = timelineHandlers(crmDeps);
const onEvent = timelineEvents({
  grants: testGrantsReads,
  parties: testPartyReads,
  resolveParty: testResolveParty,
  attempt: (tx, work) => attempt(tx, work),
});

const inTenant = <T>(database: Db, tenant: TestTenant, work: (tx: Tx) => Promise<T>) =>
  withTenant(database, trustedTenantId(tenant.id), work);

function request(tenant: TestTenant, member: string) {
  const events: Event[] = [];
  const context: CrmContext = {
    audit: {
      record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
      read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
    },
    config: { record: () => Promise.resolve() },
    session: {
      userId: randomUUID(),
      tenant: tenant.id,
      email: () => Promise.resolve('x@example.test'),
    },
    membership: { id: member },
  };
  return { events, context };
}

const asStaff = <T>(
  tenant: TestTenant,
  member: string,
  work: (r: ReturnType<typeof request> & { tx: Tx }) => Promise<T>,
) => inTenant(api, tenant, (tx) => work({ tx, ...request(tenant, member) }));
const asA = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(a, memberA, work);
const asB = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(b, memberB, work);

const query = <T extends object>(tenant: TestTenant, sql: string, values: unknown[] = []) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(sql, values)).rows);

const countOf = async (tenant: TestTenant, table: string) =>
  Number((await query<{ n: string }>(tenant, `SELECT count(*) AS n FROM ${table}`))[0]?.n);

const rejection = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error('Expected the call to fail.');
};

/** One of grants' events as the outbox would deliver it, checked by parseEvent(). */
const envelope = (tenant: TestTenant, type: string, data: Record<string, string>) =>
  parseEvent({
    id: randomUUID(),
    tenantId: tenant.id,
    sequence: 1,
    occurredAt: '2026-11-02T10:00:00Z',
    requestId: randomUUID(),
    causedBy: null,
    type,
    data,
  });

const submitted = (tenant: TestTenant, s: Submission, applicationId = s.application) =>
  envelope(tenant, 'grants.application_submitted.v1', {
    applicationId,
    roundId: s.parts.round,
    programmeId: s.programme,
    organisationId: s.parts.organisation,
    applicantPersonId: s.parts.person,
    route: 'portal',
    timing: 'on_time',
    submittedAt: '2026-11-02T10:00:00Z',
  });

const released = (tenant: TestTenant, s: Submission, decisionId: string) =>
  envelope(tenant, 'grants.decision_released.v1', {
    decisionId,
    applicationId: s.application,
    roundId: s.parts.round,
    organisationId: s.parts.organisation,
    recipientPersonId: s.parts.person,
    releasedAt: '2026-11-03T10:00:00Z',
  });

const deliver = (tenant: TestTenant, event: ReturnType<typeof envelope>) =>
  inTenant(worker, tenant, (tx) => onEvent(tx, event));

const items = (tenant: TestTenant, party: string) =>
  query<{
    kind: string;
    occurred_at: Date;
    source_module: string;
    source_entity_type: string;
    source_entity_id: string;
    summary: string | null;
    recorded_by: string | null;
  }>(tenant, 'SELECT * FROM crm.interaction WHERE party_id = $1 ORDER BY kind', [party]);

const switchCrm = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, (client) =>
    client.query(
      `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
       VALUES ($1, 'crm', true, 'operator')`,
      [tenant.id],
    ),
  );

beforeAll(async () => {
  const apiSettings = databaseSettings('app_api', 4);
  api = createDatabase({
    host: apiSettings.host,
    port: apiSettings.port,
    database: apiSettings.database,
    password: apiSettings.password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  const workerSettings = databaseSettings('app_worker', 4);
  worker = createDatabase({
    host: workerSettings.host,
    port: workerSettings.port,
    database: workerSettings.database,
    password: workerSettings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b, c, d] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  memberA = await asMigratorIn(a.id, (client) => addMember(client, a));
  memberB = await asMigratorIn(b.id, (client) => addMember(client, b));
  await Promise.all([switchCrm(a), switchCrm(b)]);
}, 60_000);

afterAll(async () => {
  await Promise.all([api.destroy(), worker.destroy()]);
});

describe('submitted application', () => {
  it('adds one reference-only item to the organisation and the applicant, once', async () => {
    const submission = await asMigratorIn(a.id, (client) => addSubmission(client, a));
    const event = submitted(a, submission);
    expect(await deliver(a, event)).toBe('recorded');
    expect(await deliver(a, event)).toBe('recorded');

    const source = {
      kind: 'application_submitted',
      source_module: 'grants',
      source_entity_type: 'grants.application',
      source_entity_id: submission.application,
      summary: null,
      recorded_by: null,
    };
    for (const party of [submission.parts.organisation, submission.parts.person]) {
      const found = await items(a, party);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject(source);
    }
    const [application] = await query<{ submitted_at: Date }>(
      a,
      'SELECT submitted_at FROM grants.application WHERE id = $1',
      [submission.application],
    );
    expect((await items(a, submission.parts.person))[0]?.occurred_at).toEqual(
      application?.submitted_at,
    );
  });

  it('follows a merged person to the record that was kept', async () => {
    const submission = await asMigratorIn(a.id, (client) => addSubmission(client, a));
    const survivor = await asMigratorIn(a.id, (client) => addPerson(client, a));
    await query(a, "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      submission.parts.person,
      survivor,
    ]);
    await deliver(a, submitted(a, submission));
    expect(await items(a, submission.parts.person)).toHaveLength(0);
    expect(await items(a, survivor)).toHaveLength(1);
  });

  it('ends with missing for an application that is gone or still a draft', async () => {
    const submission = await asMigratorIn(a.id, (client) => addSubmission(client, a));
    expect(await deliver(a, submitted(a, submission, randomUUID()))).toBe('missing');
    expect(await countOf(a, `crm.interaction WHERE party_id = '${submission.parts.person}'`)).toBe(
      0,
    );
  });

  it('writes nothing while crm is off, and a later switch-on does not backfill', async () => {
    const submission = await asMigratorIn(c.id, (client) => addSubmission(client, c));
    expect(await deliver(c, submitted(c, submission))).toBe('off');
    await switchCrm(c);
    expect(await countOf(c, 'crm.interaction')).toBe(0);
  });

  it("cannot read another tenant's application or write to another tenant's party", async () => {
    const submission = await asMigratorIn(a.id, (client) => addSubmission(client, a));
    const before = [await countOf(a, 'crm.interaction'), await countOf(b, 'crm.interaction')];
    expect(await deliver(b, submitted(b, submission))).toBe('missing');
    expect([await countOf(a, 'crm.interaction'), await countOf(b, 'crm.interaction')]).toEqual(
      before,
    );
  });
});

describe('released decision', () => {
  it('adds one item at its release time, once', async () => {
    const decision = await asMigratorIn(a.id, (client) => addReleased(client, a));
    const event = released(a, decision, decision.decision);
    expect(await deliver(a, event)).toBe('recorded');
    expect(await deliver(a, event)).toBe('recorded');
    for (const party of [decision.parts.organisation, decision.parts.person]) {
      const found = await items(a, party);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        kind: 'decision_released',
        source_entity_type: 'grants.decision',
        source_entity_id: decision.decision,
        summary: null,
      });
    }
    const [row] = await query<{ released_at: Date }>(
      a,
      'SELECT released_at FROM grants.decision WHERE id = $1',
      [decision.decision],
    );
    expect((await items(a, decision.parts.person))[0]?.occurred_at).toEqual(row?.released_at);
  });

  it('writes nothing for a decision that is not released (rule 8), and changes nothing in grants', async () => {
    const submission = await asMigratorIn(a.id, (client) => addSubmission(client, a));
    const decision = await asMigratorIn(a.id, (client) =>
      insertRow(client, 'grants.decision', decisionRow(a, submission)),
    );
    expect(await deliver(a, released(a, submission, decision))).toBe('not_released');
    expect(await items(a, submission.parts.person)).toHaveLength(0);
    const [row] = await query<{ released_at: Date | null }>(
      a,
      'SELECT released_at FROM grants.decision WHERE id = $1',
      [decision],
    );
    expect(row?.released_at).toBeNull();
  });

  it('ends with missing for a decision that is gone, and in another tenant', async () => {
    const decision = await asMigratorIn(a.id, (client) => addReleased(client, a));
    expect(await deliver(a, released(a, decision, randomUUID()))).toBe('missing');
    expect(await deliver(b, released(b, decision, decision.decision))).toBe('missing');
    expect(await items(a, decision.parts.person)).toHaveLength(0);
  });

  it('writes nothing while crm is off', async () => {
    const decision = await asMigratorIn(d.id, (client) => addReleased(client, d));
    expect(await deliver(d, released(d, decision, decision.decision))).toBe('off');
    expect(await countOf(d, 'crm.interaction')).toBe(0);
  });
});

describe('timeline', () => {
  it('lists notes and module items newest first as references, and audits the read', async () => {
    const organisation = await asMigratorIn(a.id, (client) => addOrganisation(client, a));
    const entity = randomUUID();
    await asMigratorIn(a.id, async (client) => {
      await insertRow(
        client,
        'crm.interaction',
        noteRow(a, organisation, memberA, { occurred_at: '2026-11-01T09:00:00Z' }),
      );
      await insertRow(
        client,
        'crm.interaction',
        eventRow(a, organisation, {
          occurred_at: '2026-11-02T09:00:00Z',
          source_entity_id: entity,
        }),
      );
    });

    const { page, events } = await asA(async ({ tx, context, events }) => ({
      events,
      page: await handlers.getTimeline({
        tx,
        context,
        input: { params: { partyId: organisation }, query: {} },
      }),
    }));
    expect(page.nextCursor).toBeNull();
    expect(page.interactions).toMatchObject([
      {
        kind: 'application_submitted',
        occurredAt: '2026-11-02T09:00:00.000Z',
        module: 'grants',
        source: { module: 'grants', entityType: 'grants.application', entityId: entity },
        summary: null,
        recordedBy: null,
      },
      {
        kind: 'call',
        module: 'crm',
        source: null,
        summary: SUMMARY,
        recordedBy: memberA,
      },
    ]);
    expect(events).toEqual([
      {
        read: true,
        action: 'crm.timeline.viewed',
        entityId: organisation,
        subjectPartyId: organisation,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(SUMMARY);
  });

  it('pages without repeating an item', async () => {
    const person = await asMigratorIn(a.id, (client) => addPerson(client, a));
    await asMigratorIn(a.id, async (client) => {
      for (let n = 0; n < 55; n++) {
        await insertRow(
          client,
          'crm.interaction',
          eventRow(a, person, {
            occurred_at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
          }),
        );
      }
    });
    const read = (cursor?: string) =>
      asA(({ tx, context }) =>
        handlers.getTimeline({
          tx,
          context,
          input: { params: { partyId: person }, query: { cursor } },
        }),
      );
    const first = await read();
    expect(first.interactions).toHaveLength(50);
    const second = await read(first.nextCursor ?? undefined);
    expect(second.interactions).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.interactions, ...second.interactions].map(({ id }) => id);
    expect(new Set(ids).size).toBe(55);
  });

  it("reads another tenant's party as missing, and writes no audit event", async () => {
    const person = await asMigratorIn(a.id, (client) => addPerson(client, a));
    let audited: Event[] = [{ read: false, action: 'untouched', entityId: '' }];
    const refusal = await rejection(
      asB(({ tx, context, events }) => {
        audited = events;
        return handlers.getTimeline({
          tx,
          context,
          input: { params: { partyId: person }, query: {} },
        });
      }),
    );
    expect(audited).toEqual([]);
    expect(refusal.message).toBe('Not found');
  });
});

describe('manual interaction', () => {
  const input = (summary: string) => ({
    kind: 'meeting' as const,
    occurredAt: '2026-11-04T14:30:00.000Z',
    summary,
  });

  it('stores the summary and the session’s member, and audits ids and the kind only', async () => {
    const person = await asMigratorIn(a.id, (client) => addPerson(client, a));
    const { row, events } = await asA(async ({ tx, context, events }) => ({
      events,
      row: await handlers.recordInteraction({
        tx,
        context,
        input: {
          params: { partyId: person },
          body: input('Met Zephyrine Quillfeather about gardens'),
        },
      }),
    }));
    expect(row).toMatchObject({
      kind: 'meeting',
      occurredAt: '2026-11-04T14:30:00.000Z',
      module: 'crm',
      source: null,
      summary: 'Met Zephyrine Quillfeather about gardens',
      recordedBy: memberA,
    });
    expect(events).toEqual([
      {
        read: false,
        action: 'crm.interaction.recorded',
        entityId: row.id,
        subjectPartyId: person,
        changes: {
          'crm.interaction.party_id': { after: person },
          'crm.interaction.kind': { after: 'meeting' },
          'crm.interaction.summary': {},
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Zephyrine');
    expect((await items(a, person))[0]).toMatchObject({
      source_module: 'crm',
      recorded_by: memberA,
    });
  });

  it("refuses another tenant's party as missing, and a merged record with a plain message", async () => {
    const person = await asMigratorIn(a.id, (client) => addPerson(client, a));
    const before = await countOf(b, 'crm.interaction');
    const missing = await rejection(
      asB(({ tx, context }) =>
        handlers.recordInteraction({
          tx,
          context,
          input: { params: { partyId: person }, body: input('Cross tenant note') },
        }),
      ),
    );
    expect(missing.message).toBe('Not found');
    expect(await countOf(b, 'crm.interaction')).toBe(before);
    expect(await countOf(a, `crm.interaction WHERE summary = 'Cross tenant note'`)).toBe(0);

    const survivor = await asMigratorIn(a.id, (client) => addPerson(client, a));
    await query(a, "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      person,
      survivor,
    ]);
    const merged = await rejection(
      asA(({ tx, context }) =>
        handlers.recordInteraction({
          tx,
          context,
          input: { params: { partyId: person }, body: input('Merged note') },
        }),
      ),
    );
    expect(merged.status).toBe(409);
    expect(await countOf(a, `crm.interaction WHERE party_id = '${person}'`)).toBe(0);
  });
});
