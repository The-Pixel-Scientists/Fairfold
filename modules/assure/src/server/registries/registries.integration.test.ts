// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registry lookups against the test database (ADR 0031): the refresh job as
// app_worker and the lookup routes' handlers as app_api, each in a tenant's
// transaction. The registers answer from hand-written fixtures; nothing
// calls a live one. Covers what the job stores and audits, a second delivery,
// a failed refresh keeping the last good snapshot, the module switch, the
// scan, and that a lookup never changes a party or an application.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { insertAuditEvent, type AuditChanges } from '@pixel-scientists/db';
import {
  defineQueue,
  JobError,
  sendJob,
  startJobSender,
  stopJobSender,
  type JobSender,
} from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { auditEntityType } from '@pixel-scientists/domain/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { addApplication } from '../../../../../packages/db/test/grants/application-fixtures.ts';
import { databaseSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import { jobRows } from '../../../../../packages/db/test/jobs/helpers.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { registrySchema, type AssureAuditAction } from '../../contracts/index.ts';
import { createRegistryAdapters } from './adapters.ts';
import { registryHandlers, type RegistryContext } from './handlers.ts';
import {
  REFRESH_QUEUE,
  registryRefresh,
  SCAN_LIMIT,
  type QueueRefresh,
  type RefreshJob,
} from './refresh.ts';
import { Secret } from './secret.ts';
import { staleLookups, type Tx } from './store.ts';

interface AuditRow {
  readonly action: AssureAuditAction;
  readonly entityId: string;
  readonly subjectPartyId: string;
  readonly changes?: AuditChanges;
}

const auditRow = (event: AuditRow) => ({
  requestId: randomUUID(),
  action: event.action,
  entityType: auditEntityType(event.action),
  entityId: event.entityId,
  changes: event.changes ?? {},
  subjectPartyId: event.subjectPartyId,
});

/**
 * The two audit rows apps/api's writer records, written directly because a
 * module cannot import the writer: the job's, as the system for the member
 * whose request caused it, and a request's, as the member. The job reads its
 * own event to tell a second delivery from a first, so the rows must be real.
 */
const auditAsJob = (tx: Tx, running: RefreshJob, event: AuditRow): Promise<void> =>
  insertAuditEvent(tx, {
    ...auditRow(event),
    actorKind: 'system',
    actorId: null,
    job: { jobId: running.id, originMembershipId: running.context.causingUserId },
  });

const auditAsMember = (tx: Tx, membershipId: string, event: AuditRow): Promise<void> =>
  insertAuditEvent(tx, { ...auditRow(event), actorKind: 'user', actorId: membershipId });

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const KEY = 'KEY-sentinel-7f3a9c'; // gitleaks:allow
const CHARITY = '1999001';
const OFFICER = 'Invented Trustee One';
const ADDRESS_TOWN = 'Testtown';

let answer: () => Response = () => json(fixture('charity-commission'));
let calls = 0;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A clock a second further on at each reading, so the register's rate limit never depends on how fast the tests run. */
let tick = Date.now();
const adapters = createRegistryAdapters(
  { charityCommission: new Secret(KEY) },
  {
    now: () => new Date((tick += 1_000)),
    fetch: () => {
      calls++;
      return Promise.resolve(answer());
    },
  },
);

let api: ReturnType<typeof createDatabase<unknown>>;
let worker: ReturnType<typeof createDatabase<unknown>>;
let apiSender: JobSender;
let workerSender: JobSender;
let skew = 0;

interface Fixture {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly organisation: string;
  readonly application: string;
}

async function addFixture(on = true): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant, ['due_diligence_officer']);
    const { id: application, parts } = await addApplication(client, tenant);
    await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: parts.organisation,
      scheme: 'GB-CHC',
      identifier: CHARITY,
    });
    if (on) {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module: 'assure',
        enabled: true,
        updated_by_kind: 'operator',
      });
    }
    return { tenant, member, organisation: parts.organisation, application };
  });
}

let a: Fixture;
let b: Fixture;
let off: Fixture;

beforeAll(async () => {
  {
    const { host, port, database, password } = databaseSettings('app_api', 4);
    api = createDatabase<unknown>({
      host,
      port,
      database,
      password,
      role: 'app_api',
      maxConnections: 4,
      applicationName: 'tps-db-tests',
    });
  }
  {
    const { host, port, database, password } = databaseSettings('app_worker', 4);
    worker = createDatabase<unknown>({
      host,
      port,
      database,
      password,
      role: 'app_worker',
      maxConnections: 4,
      applicationName: 'tps-db-tests',
    });
  }
  const onError = (error: Error) => {
    throw error;
  };
  apiSender = await startJobSender(api, onError);
  workerSender = await startJobSender(worker, onError);
  [a, b, off] = [await addFixture(), await addFixture(), await addFixture(false)];
}, 60_000);

afterAll(async () => {
  await stopJobSender(apiSender);
  await stopJobSender(workerSender);
  await withClient('migrator', async (client) => {
    await client.query('DELETE FROM pgboss.job WHERE name = $1 AND data ->> $2 = ANY($3)', [
      'assure.registry_refresh',
      'tenantId',
      [a, b, off].map(({ tenant }) => tenant.id),
    ]);
  });
  await api.destroy();
  await worker.destroy();
});

/**
 * The queue as apps/api defines it, and what it passes in: sending in the
 * caller's transaction, and the job's audit as the writer there records it,
 * as the system for the member whose request caused the job.
 */
const queue = defineQueue(
  REFRESH_QUEUE,
  'tenant',
  z.strictObject({
    slot: idSchema.optional(),
    organisationId: idSchema.optional(),
    registry: registrySchema.optional(),
  }),
);

const queueWith =
  (sender: () => JobSender): QueueRefresh =>
  (tx, data, by) =>
    sendJob(tx, queue, data, { sender: sender(), ...by });

const handle = registryRefresh({
  adapters,
  now: () => new Date(Date.now() + skew),
  queueRefresh: queueWith(() => workerSender),
  fail: (code) => new JobError(code),
  audit: auditAsJob,
});

function run(fixture: Fixture, data: unknown, id: string = randomUUID(), by?: string) {
  const running: RefreshJob = {
    id,
    data,
    context: { requestId: randomUUID(), causingUserId: by ?? null },
  };
  return withTenant(worker, trustedTenantId(fixture.tenant.id), (trx) => handle(trx, running));
}

const refresh = (fixture: Fixture, id?: string, by?: string) =>
  run(fixture, { organisationId: fixture.organisation, registry: 'charity_commission' }, id, by);

/** Rows as migrator, with the tenant set. */
const query = <T extends object>(fixture: Fixture, text: string, values: unknown[] = []) =>
  asMigratorIn(fixture.tenant.id, async (client) => (await client.query<T>(text, values)).rows);

const count = async (fixture: Fixture, table: string) =>
  Number((await query<{ n: string }>(fixture, `SELECT count(*) AS n FROM ${table}`))[0]?.n);

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as { code?: string; message: string },
  );

describe('the refresh job', () => {
  it('stores the found entry with its officers, and audits it as the system for the member who asked', async () => {
    const id = randomUUID();
    await refresh(a, id, a.member);
    const [snapshot] = await query<Record<string, unknown>>(
      a,
      'SELECT * FROM assure.lookup_snapshot',
    );
    expect(snapshot).toMatchObject({
      organisation_id: a.organisation,
      registry: 'charity_commission',
      scheme: 'GB-CHC',
      identifier: CHARITY,
      outcome: 'found',
      registry_status: 'registered',
      registered_name: 'Invented Community Trust',
      income_minor: '12500000',
      income_currency: 'GBP',
      list_id: null,
    });
    const officers = await query<{ name: string; role: string; person_id: string | null }>(
      a,
      'SELECT name, role, person_id FROM assure.lookup_officer ORDER BY name',
    );
    expect(officers).toEqual([
      { name: 'Invented Trustee One', role: 'trustee', person_id: null },
      { name: 'Invented Trustee Two', role: 'trustee', person_id: null },
    ]);
    const events = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.lookup.refreshed'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_kind: 'system',
      actor_id: null,
      entity_id: snapshot?.['id'],
      subject_party_id: a.organisation,
      job_id: id,
      origin_membership_id: a.member,
    });
    const audit = JSON.stringify(events[0]);
    for (const secret of [KEY, OFFICER, ADDRESS_TOWN, CHARITY]) expect(audit).not.toContain(secret);
  });

  it('leaves one snapshot for a job delivered twice', async () => {
    const id = randomUUID();
    const before = await count(b, 'assure.lookup_snapshot');
    await refresh(b, id);
    await refresh(b, id);
    expect(await count(b, 'assure.lookup_snapshot')).toBe(before + 1);
    expect(await count(b, 'assure.lookup_officer')).toBe(2);
  });

  it('keeps the last good snapshot when a refresh fails, and fails with a code only', async () => {
    const before = await count(a, 'assure.lookup_snapshot');
    for (const [status, code] of [
      [500, 'internal'],
      [429, 'internal'],
      [401, 'internal'],
    ] as const) {
      answer = () => json({ message: `registry said ${KEY}` }, status);
      const error = await failure(refresh(a));
      expect(error).toMatchObject({ code });
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(error?.message).not.toContain(KEY);
    }
    answer = () => json({ charity_name: 1 });
    expect(await failure(refresh(a))).toMatchObject({ code: 'precondition_failed' });
    answer = () => json(fixture('charity-commission'));
    expect(await count(a, 'assure.lookup_snapshot')).toBe(before);
  });

  it('stores a register that has no entry as not found, beside the older found snapshot', async () => {
    answer = () => json({}, 404);
    await refresh(a);
    answer = () => json(fixture('charity-commission'));
    const rows = await query<{ outcome: string; registered_name: string | null }>(
      a,
      'SELECT outcome, registered_name FROM assure.lookup_snapshot ORDER BY fetched_at, id',
    );
    expect(rows.at(-1)).toEqual({ outcome: 'not_found', registered_name: null });
    expect(rows.some(({ outcome }) => outcome === 'found')).toBe(true);
  });

  it('does nothing when assure is off for the tenant, and calls no register', async () => {
    const before = calls;
    await refresh(off);
    expect(calls).toBe(before);
    expect(await count(off, 'assure.lookup_snapshot')).toBe(0);
  });

  it("cannot read another tenant's organisation or write its snapshot", async () => {
    const before = calls;
    const error = await failure(
      run(a, { organisationId: b.organisation, registry: 'charity_commission' }),
    );
    expect(error).toMatchObject({ code: 'not_found' });
    expect(calls).toBe(before);
    const rows = await query<{ organisation_id: string }>(
      b,
      'SELECT organisation_id FROM assure.lookup_snapshot',
    );
    expect(rows.every(({ organisation_id }) => organisation_id === b.organisation)).toBe(true);
  });

  it('refuses a payload that is neither a refresh nor a scan, and one for a register with no key', async () => {
    expect(await failure(run(a, {}))).toMatchObject({ code: 'invalid_payload' });
    expect(await failure(run(a, { slot: randomUUID(), registry: 'ccni' }))).toMatchObject({
      code: 'invalid_payload',
    });
    expect(
      await failure(run(a, { organisationId: a.organisation, registry: 'companies_house' })),
    ).toMatchObject({ code: 'precondition_failed' });
  });

  it('never creates, links, verifies or changes a party or an application', async () => {
    const tables = async (fixture: Fixture) =>
      query<{ table: string; n: string; digest: string }>(
        fixture,
        `SELECT t.table_schema || '.' || t.table_name AS "table",
                (xpath('/row/n/text()', query_to_xml(
                  format('SELECT count(*) AS n FROM %I.%I', t.table_schema, t.table_name),
                  false, true, '')))[1]::text AS n,
                (xpath('/row/d/text()', query_to_xml(
                  format('SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) AS d FROM %I.%I x',
                         t.table_schema, t.table_name), false, true, '')))[1]::text AS digest
           FROM information_schema.tables t
          WHERE t.table_schema IN ('party', 'grants') AND t.table_type = 'BASE TABLE'
          ORDER BY 1`,
      );
    const before = await tables(a);
    expect(before.length).toBeGreaterThan(5);
    await refresh(a, randomUUID(), a.member);
    expect(await tables(a)).toEqual(before);
    const [identifier] = await query<{ verified_at: Date | null; verified_by: string | null }>(
      a,
      'SELECT verified_at, verified_by FROM party.organisation_identifier',
    );
    expect(identifier).toEqual({ verified_at: null, verified_by: null });
  });
});

describe('the scheduled scan', () => {
  const scan = (fixture: Fixture) => run(fixture, { slot: randomUUID() });
  const queued = (fixture: Fixture) =>
    jobRows('name = $1 AND data ->> $2 = $3', [
      'assure.registry_refresh',
      'tenantId',
      fixture.tenant.id,
    ]);

  it('queues nothing while every snapshot is fresh', async () => {
    const before = (await queued(a)).length;
    await scan(a);
    expect((await queued(a)).length).toBe(before);
  });

  it('queues a refresh, by ids only, for each snapshot past its age, and only where assure is on', async () => {
    skew = 31 * 86_400_000;
    const before = (await queued(a)).length;
    await scan(a);
    await scan(off);
    skew = 0;
    const rows = (await queued(a)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({
      organisationId: a.organisation,
      registry: 'charity_commission',
      tenantId: a.tenant.id,
      causingUserId: null,
    });
    expect(JSON.stringify(rows[0]?.data)).not.toContain(CHARITY);
    expect(await queued(off)).toEqual([]);
  });

  it("queues none for another tenant's snapshots, and at most the cap", async () => {
    const stale = await withTenant(worker, trustedTenantId(a.tenant.id), (trx: Tx) =>
      staleLookups(trx, ['charity_commission'], new Date(Date.now() + 86_400_000), 1),
    );
    expect(stale).toEqual([{ organisationId: a.organisation, registry: 'charity_commission' }]);
    expect(SCAN_LIMIT).toBeGreaterThan(0);
    expect(queue.kind).toBe('tenant');
  });
});

const routes = () =>
  registryHandlers({
    adapters,
    queueRefresh: queueWith(() => apiSender),
    notFound: () => new Error('not found'),
    refuse: (status, detail) => Object.assign(new Error(detail), { status }),
  });

function as<T>(fixture: Fixture, work: (tx: Tx, context: RegistryContext) => Promise<T>) {
  return withTenant(api, trustedTenantId(fixture.tenant.id), (tx) => {
    const write = (event: Parameters<RegistryContext['audit']['record']>[0]) =>
      auditAsMember(tx, fixture.member, event);
    return work(tx, {
      requestId: randomUUID(),
      membership: { id: fixture.member },
      audit: { record: write, read: write },
    });
  });
}

describe('the routes', () => {
  it('lists the newest snapshot with an officer count and no names, and the registers not set up', async () => {
    const lookups = await as(a, (tx, context) =>
      routes().listOrganisationLookups({
        tx,
        context,
        input: { params: { organisationId: a.organisation } },
      }),
    );
    expect(lookups.notSetUp).toEqual(['companies_house', 'oscr', 'ccni']);
    expect(lookups.snapshots).toHaveLength(1);
    expect(lookups.snapshots[0]).toMatchObject({
      registry: 'charity_commission',
      identifier: CHARITY,
    });
    expect(JSON.stringify(lookups)).not.toContain(OFFICER);
  });

  it('queues a refresh in the request, by ids only, and audits it with the organisation as subject', async () => {
    const before = calls;
    const queuedAt = Date.now();
    const accepted = await as(a, (tx, context) =>
      routes().refreshOrganisationLookup({
        tx,
        context,
        input: {
          params: { organisationId: a.organisation },
          body: { registry: 'charity_commission' },
        },
      }),
    );
    expect(calls).toBe(before);
    expect(accepted).toMatchObject({ registry: 'charity_commission' });
    expect(Date.parse(accepted.queuedAt)).toBeGreaterThanOrEqual(queuedAt - 1000);
    const [row] = await jobRows('id = $1', [accepted.jobId]);
    expect(row?.data).toEqual({
      organisationId: a.organisation,
      registry: 'charity_commission',
      tenantId: a.tenant.id,
      requestId: (row?.data as { requestId: string }).requestId,
      causingUserId: a.member,
    });
    const payload = JSON.stringify(row?.data);
    for (const secret of [KEY, CHARITY, OFFICER]) expect(payload).not.toContain(secret);
    const [event] = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.lookup.refresh_requested'",
    );
    expect(event).toMatchObject({
      actor_kind: 'user',
      actor_id: a.member,
      entity_id: accepted.jobId,
      subject_party_id: a.organisation,
    });
  });

  it("answers another tenant's organisation as it answers a missing one, and queues nothing", async () => {
    const missing = randomUUID();
    const before = (
      await jobRows('name = $1 AND data ->> $2 = $3', [
        'assure.registry_refresh',
        'organisationId',
        b.organisation,
      ])
    ).length;
    for (const organisationId of [b.organisation, missing]) {
      const read = await as(a, (tx, context) =>
        routes().listOrganisationLookups({ tx, context, input: { params: { organisationId } } }),
      ).catch((error: unknown) => error);
      const refreshed = await as(a, (tx, context) =>
        routes().refreshOrganisationLookup({
          tx,
          context,
          input: { params: { organisationId }, body: { registry: 'charity_commission' } },
        }),
      ).catch((error: unknown) => error);
      expect(read).toEqual(new Error('not found'));
      expect(refreshed).toEqual(new Error('not found'));
    }
    const after = await jobRows('name = $1 AND data ->> $2 = $3', [
      'assure.registry_refresh',
      'organisationId',
      b.organisation,
    ]);
    expect(after).toHaveLength(before);
  });

  it('refuses a body the contract does not allow, and a register the organisation has no identifier for', async () => {
    const attempt = (body: unknown) =>
      as(a, (tx, context) =>
        routes().refreshOrganisationLookup({
          tx,
          context,
          input: { params: { organisationId: a.organisation }, body },
        }),
      ).catch((error: unknown) => error);
    expect(await attempt({ registry: 'nope' })).toMatchObject({ status: 400 });
    expect(await attempt({ registry: 'charity_commission', tenantId: b.tenant.id })).toMatchObject({
      status: 400,
    });
    expect(await attempt({})).toMatchObject({ status: 400 });
    expect(await attempt({ registry: 'companies_house' })).toMatchObject({ status: 409 });
  });

  it("reads a snapshot's officers by name, audits the read, and hides another tenant's", async () => {
    const [snapshot] = await query<{ id: string }>(
      a,
      "SELECT id FROM assure.lookup_snapshot WHERE outcome = 'found' ORDER BY fetched_at DESC LIMIT 1",
    );
    const snapshotId = snapshot?.id ?? '';
    const read = await as(a, (tx, context) =>
      routes().listLookupOfficers({ tx, context, input: { params: { snapshotId } } }),
    );
    expect(read.officers.map(({ name }) => name)).toEqual([
      'Invented Trustee One',
      'Invented Trustee Two',
    ]);
    const [event] = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.lookup.officers_viewed'",
    );
    expect(event).toMatchObject({
      entity_id: snapshotId,
      subject_party_id: a.organisation,
      actor_id: a.member,
    });
    expect(JSON.stringify(event)).not.toContain(OFFICER);
    const other = await as(b, (tx, context) =>
      routes().listLookupOfficers({ tx, context, input: { params: { snapshotId } } }),
    ).catch((error: unknown) => error);
    expect(other).toEqual(new Error('not found'));
    expect(await count(b, "app.audit_event WHERE action = 'assure.lookup.officers_viewed'")).toBe(
      0,
    );
  });
});

describe('an erased organisation', () => {
  const stale = 31 * 86_400_000;
  const refreshJobs = (fixture: Fixture) =>
    jobRows('name = $1 AND data ->> $2 = $3', [
      'assure.registry_refresh',
      'tenantId',
      fixture.tenant.id,
    ]);

  it('is never looked up or queued, and the tenant’s other organisations are still refreshed', async () => {
    const c = await addFixture();
    const other = await asMigratorIn(c.tenant.id, async (client) => {
      const { parts } = await addApplication(client, c.tenant);
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: c.tenant.id,
        organisation_id: parts.organisation,
        scheme: 'GB-CHC',
        identifier: '1999002',
      });
      return parts.organisation;
    });
    const refreshOther = async () => {
      answer = () =>
        json({ ...(fixture('charity-commission') as object), reg_charity_number: 1999002 });
      try {
        await run(c, { organisationId: other, registry: 'charity_commission' });
      } finally {
        answer = () => json(fixture('charity-commission'));
      }
    };
    await refresh(c);
    await refreshOther();
    await query(
      c,
      "UPDATE party.organisation SET address_line1 = 'erased', address_line2 = NULL, address_town = 'erased', address_postcode = 'erased', address_country_code = 'ZZ' WHERE id = $1",
      [c.organisation],
    );
    await query(c, "UPDATE party.party SET status = 'erased' WHERE id = $1", [c.organisation]);
    const snapshots = await count(c, 'assure.lookup_snapshot');

    const before = calls;
    expect(await failure(refresh(c))).toMatchObject({ code: 'precondition_failed' });
    expect(calls).toBe(before);
    expect(await count(c, 'assure.lookup_snapshot')).toBe(snapshots);

    const refused = await as(c, (tx, context) =>
      routes().refreshOrganisationLookup({
        tx,
        context,
        input: {
          params: { organisationId: c.organisation },
          body: { registry: 'charity_commission' },
        },
      }),
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 409 });

    const queuedBefore = (await refreshJobs(c)).length;
    skew = stale;
    await run(c, { slot: randomUUID() });
    skew = 0;
    const queued = (await refreshJobs(c)).slice(queuedBefore);
    expect(queued.map(({ data }) => (data as { organisationId: string }).organisationId)).toEqual([
      other,
    ]);

    await refreshOther();
    expect(await count(c, 'assure.lookup_snapshot')).toBe(snapshots + 1);
  }, 60_000);

  it('leaves an erased organisation out of the stale lookups, so it uses none of the scan’s places', async () => {
    const c = await addFixture();
    await refresh(c);
    await query(
      c,
      "UPDATE party.organisation SET address_line1 = 'erased', address_line2 = NULL, address_town = 'erased', address_postcode = 'erased', address_country_code = 'ZZ' WHERE id = $1",
      [c.organisation],
    );
    await query(c, "UPDATE party.party SET status = 'erased' WHERE id = $1", [c.organisation]);
    const found = await withTenant(worker, trustedTenantId(c.tenant.id), (trx: Tx) =>
      staleLookups(trx, ['charity_commission'], new Date(Date.now() + stale), SCAN_LIMIT),
    );
    expect(found).toEqual([]);
  }, 30_000);
});
