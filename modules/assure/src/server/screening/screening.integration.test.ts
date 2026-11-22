// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sanctions screening against the test database (ADR 0031): the list
// download job and the screening job as app_worker, the routes' handlers as
// app_api, each in a tenant's transaction. The list is the hand-written
// fixture; nothing calls a live one. The list loader that ADR 0031 asks
// db-security for does not exist yet, so a stand-in with the call shape
// store.ts uses is created for this file and dropped after it.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { insertAuditEvent, type AuditChanges } from '@pixel-scientists/db';
import {
  defineEventHandler,
  defineQueue,
  JobError,
  sendJob,
  startJobSender,
  stopJobSender,
  type JobSender,
} from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { defineEvent } from '@pixel-scientists/domain/events';
import { auditEntityType } from '@pixel-scientists/domain/platform';
import { organisationName } from '@pixel-scientists/party/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { runJob as runWorkerJob } from '../../../../../packages/db/src/jobs/handler.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import {
  databaseSettings,
  withClient,
  withRoleClient,
} from '../../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import { officerRow, snapshotRow } from '../../../../../packages/db/test/assure/fixtures.ts';
import { jobRows } from '../../../../../packages/db/test/jobs/helpers.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { AssureAuditAction } from '../../contracts/index.ts';
import { screeningHandlers, type ScreeningContext } from './handlers.ts';
import { sanctionsListRefresh } from './ingest.ts';
import {
  CANDIDATE_CAP,
  DEFAULT_THRESHOLD,
  screeningJob,
  SCREENING_QUEUE,
  type MatchFound,
  type PartyReader,
  type ScreeningJob,
} from './run.ts';
import { submissionSubscriber } from './submission.ts';
import { candidatesQuery, type Tx } from './store.ts';

const LIST = readFileSync(new URL('./fixtures/sanctions-list.json', import.meta.url), 'utf8');
const NAMES = ['Zorvan', 'Quillbright', 'Northgate', 'Mirela', 'Tavendish', 'Brightwater'];

let api: ReturnType<typeof createDatabase<unknown>>;
let worker: ReturnType<typeof createDatabase<unknown>>;
let apiSender: JobSender;
let workerSender: JobSender;
let skew = 0;

interface Fixture {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly organisation: string;
  /** A contact and an officer, whose names are screened with the organisation's. */
  readonly contact: string;
  readonly snapshot: string;
}

/** The contacts' names, which party's contract would give; the organisation's own name is read through it. */
const contacts = new Map<string, { id: string; name: string }>();

const party: PartyReader = {
  names: async (tx, id) => {
    const name = await organisationName(tx, id);
    if (name === null) return null;
    const contact = contacts.get(id);
    return [
      { partyId: id, kind: 'organisation', name },
      ...(contact === undefined
        ? []
        : [{ partyId: contact.id, kind: 'person' as const, name: contact.name }]),
    ];
  },
};

async function addFixture(
  organisationName: string,
  options: { on?: boolean; contactName?: string; officers?: readonly string[] } = {},
): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant, ['due_diligence_officer']);
    const organisation = await addOrganisation(client, tenant, { name: organisationName });
    const contact = await addPerson(client, tenant);
    const snapshot = await insertRow(
      client,
      'assure.lookup_snapshot',
      snapshotRow(tenant, organisation, { registered_name: 'MV Invented Star' }),
    );
    for (const name of options.officers ?? []) {
      await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot, { name }));
    }
    if (options.contactName !== undefined) {
      contacts.set(organisation, { id: contact, name: options.contactName });
    }
    if (options.on !== false) {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module: 'assure',
        enabled: true,
        updated_by_kind: 'operator',
      });
    }
    return { tenant, member, organisation, contact, snapshot };
  });
}

let a: Fixture;
let b: Fixture;
let off: Fixture;

/**
 * The reference tables have no writer until ADR 0031's loader exists, so for
 * this file a definer function with its signature loads the rows as their
 * owner, and the file's list versions are superseded after, so no other
 * test sees a current list. Delete this once the migration adds the loader.
 */
const STAND_IN = `
  CREATE FUNCTION assure.load_reference_list(source text, published_on date, sha256 bytea, rows jsonb)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  DECLARE
    found_id uuid;
    new_id uuid;
  BEGIN
    ALTER TABLE assure.reference_list NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE assure.sanctions_entry NO FORCE ROW LEVEL SECURITY;
    SELECT r.id INTO found_id FROM assure.reference_list r
     WHERE r.source = load_reference_list.source AND r.superseded_at IS NULL
       AND r.sha256 = load_reference_list.sha256;
    IF found_id IS NOT NULL THEN
      UPDATE assure.reference_list SET last_checked_at = pg_catalog.clock_timestamp() WHERE id = found_id;
      new_id := found_id;
    ELSE
      UPDATE assure.reference_list r SET superseded_at = pg_catalog.clock_timestamp()
       WHERE r.source = load_reference_list.source AND r.superseded_at IS NULL;
      INSERT INTO assure.reference_list (source, published_on, sha256, row_count)
        VALUES (load_reference_list.source, load_reference_list.published_on,
                load_reference_list.sha256, pg_catalog.jsonb_array_length(load_reference_list.rows))
        RETURNING id INTO new_id;
      INSERT INTO assure.sanctions_entry (list_id, designation_id, entry_kind, name_type, name,
                                          normalised_name, regime, designated_on, dates_of_birth,
                                          nationalities, country)
        SELECT new_id, x.designation_id, x.entry_kind, x.name_type, x.name, x.normalised_name,
               x.regime, x.designated_on, x.dates_of_birth, x.nationalities, x.country
          FROM pg_catalog.jsonb_to_recordset(load_reference_list.rows) AS x(
            designation_id text, entry_kind text, name_type text, name text, normalised_name text,
            regime text, designated_on date, dates_of_birth text[], nationalities text[], country text);
    END IF;
    ALTER TABLE assure.reference_list FORCE ROW LEVEL SECURITY;
    ALTER TABLE assure.sanctions_entry FORCE ROW LEVEL SECURITY;
    RETURN new_id;
  END $f$;
  GRANT EXECUTE ON FUNCTION assure.load_reference_list(text, date, bytea, jsonb) TO app_worker;`;

/** Changes the list versions as migrator, with row-level security lifted for the statement alone. */
const asOwner = (statement: string, values: unknown[] = []) =>
  withClient('migrator', async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE assure.reference_list NO FORCE ROW LEVEL SECURITY');
      await client.query(statement, values);
      await client.query('ALTER TABLE assure.reference_list FORCE ROW LEVEL SECURITY');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

const SUPERSEDE_CURRENT =
  "UPDATE assure.reference_list SET superseded_at = clock_timestamp() WHERE source = 'uk_sanctions_list' AND superseded_at IS NULL";

beforeAll(async () => {
  await withClient('migrator', async (client) => {
    await client.query(
      'DROP FUNCTION IF EXISTS assure.load_reference_list(text, date, bytea, jsonb)',
    );
    await client.query(STAND_IN);
  });
  await asOwner(SUPERSEDE_CURRENT);
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
  a = await addFixture('Northgate Invented Holdings Ltd', {
    contactName: 'Quillbright Zorvan',
    officers: ['Mirela Tavendish-Orr', 'Nobody Matching Anything'],
  });
  b = await addFixture('Brightwater Test Foundation');
  off = await addFixture('Northgate Invented Holdings Ltd', { on: false });
}, 60_000);

afterAll(async () => {
  await asOwner(SUPERSEDE_CURRENT);
  await withClient('migrator', async (client) => {
    await client.query(
      'DROP FUNCTION IF EXISTS assure.load_reference_list(text, date, bytea, jsonb)',
    );
    await client.query('DELETE FROM pgboss.job WHERE name = ANY($1) AND data ->> $2 = ANY($3)', [
      [SCREENING_QUEUE],
      'tenantId',
      [a, b, off].map(({ tenant }) => tenant.id),
    ]);
  });
  await stopJobSender(apiSender);
  await stopJobSender(workerSender);
  await api.destroy();
  await worker.destroy();
});

/** The part of grants' submission event this subscriber reads; grants' own contracts are not this project's. */
const applicationSubmitted = defineEvent('grants.application_submitted.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({ organisationId: idSchema, applicantPersonId: idSchema }),
});

const screeningQueue = defineQueue(SCREENING_QUEUE, 'tenant', z.strictObject({ runId: idSchema }));

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

const found: MatchFound[] = [];
const dependencies = {
  party,
  queueScreening: (
    tx: Tx,
    data: { runId: string },
    by: { requestId: string; causingUserId: string | null },
  ) => sendJob(tx, screeningQueue, data, { sender: workerSender, ...by }),
  audit: (tx: Tx, job: ScreeningJob, event: AuditRow) =>
    insertAuditEvent(tx, {
      ...auditRow(event),
      actorKind: 'system',
      actorId: null,
      job: { jobId: job.id, originMembershipId: job.context.causingUserId },
    }),
  publishMatchFound: (_tx: Tx, data: MatchFound) => {
    found.push(data);
    return Promise.resolve();
  },
  fail: (code: 'invalid_payload' | 'internal') => new JobError(code),
};

const screen = screeningJob({ ...dependencies, now: () => new Date(Date.now() + skew) });

function runJob(fixture: Fixture, runId: string, id: string = randomUUID()) {
  const job: ScreeningJob = {
    id,
    data: { runId },
    context: { requestId: randomUUID(), causingUserId: fixture.member },
  };
  return withTenant(worker, trustedTenantId(fixture.tenant.id), (trx) => screen(trx, job));
}

function as<T>(fixture: Fixture, work: (tx: Tx, context: ScreeningContext) => Promise<T>) {
  return withTenant(api, trustedTenantId(fixture.tenant.id), (tx) => {
    const write = (event: AuditRow) =>
      insertAuditEvent(tx, {
        ...auditRow(event),
        actorKind: 'user',
        actorId: fixture.member,
      });
    return work(tx, {
      requestId: randomUUID(),
      membership: { id: fixture.member },
      audit: { record: write, read: write },
    });
  });
}

const routes = () =>
  screeningHandlers({
    party,
    queueScreening: (tx, data, by) =>
      sendJob(tx, screeningQueue, data, { sender: apiSender, ...by }),
    notFound: () => new Error('not found'),
    refuse: (status, detail) => Object.assign(new Error(detail), { status }),
  });

/** Rows as migrator, with the tenant set. */
const query = <T extends object>(fixture: Fixture, text: string, values: unknown[] = []) =>
  asMigratorIn(fixture.tenant.id, async (client) => (await client.query<T>(text, values)).rows);

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as { code?: string; status?: number; message: string },
  );

const startRun = (fixture: Fixture, partyId: string = fixture.organisation) =>
  as(fixture, (tx, context) =>
    routes().startScreeningRun({ tx, context, input: { params: { partyId } } }),
  );

const matchesOf = (fixture: Fixture) =>
  query<{
    id: string;
    designation_id: string;
    name_source: string;
    similarity: string;
    subject_party_id: string | null;
    run_id: string;
  }>(
    fixture,
    'SELECT id, designation_id, name_source, similarity, subject_party_id, run_id FROM assure.screening_match ORDER BY created_at, id',
  );

const ingest = (
  respond: () => Promise<Response>,
  options: { url?: URL | undefined; data?: unknown; minimum?: number } = {},
) =>
  worker.transaction().execute((trx) =>
    sanctionsListRefresh({
      url: 'url' in options ? options.url : new URL('https://lists.example.test/list.json'),
      fetcher: respond,
      fail: (code) => new JobError(code),
      minimum: options.minimum ?? 1,
    })(trx, { id: randomUUID(), data: options.data ?? {} }),
  );

const listReply =
  (body: string = LIST) =>
  () =>
    Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));

const versions = () =>
  withRoleClient(
    'app_worker',
    async (client) =>
      (
        await client.query<{ id: string; row_count: number; superseded: boolean; checked: Date }>(
          `SELECT id, row_count, superseded_at IS NOT NULL AS superseded, last_checked_at AS checked
           FROM assure.reference_list WHERE source = 'uk_sanctions_list' ORDER BY downloaded_at, id`,
        )
      ).rows,
  );

describe('the list download job', () => {
  it('stores the fixture as the current version, each name normalised', async () => {
    await ingest(listReply());
    const rows = await versions();
    expect(rows.filter((row) => !row.superseded)).toHaveLength(1);
    const current = rows.find((row) => !row.superseded);
    expect(current?.row_count).toBe(8);
    const entries = await withRoleClient('app_worker', async (client) =>
      (
        await client.query<{ normalised_name: string }>(
          'SELECT normalised_name FROM assure.sanctions_entry WHERE list_id = $1 ORDER BY normalised_name',
          [current?.id],
        )
      ).rows.map((row) => row.normalised_name),
    );
    expect(entries).toContain('nandu oleksy brandvik');
    expect(entries).toHaveLength(8);
  });

  it('writes nothing new when the file has not changed, and only records the check', async () => {
    const before = await versions();
    await ingest(listReply());
    const after = await versions();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const [was] = before.filter((row) => !row.superseded);
    const [now] = after.filter((row) => !row.superseded);
    expect((now?.checked.getTime() ?? 0) > (was?.checked.getTime() ?? 0)).toBe(true);
  });

  it('refuses a list that fails its checks, with a code, and keeps the live version', async () => {
    const before = await versions();
    const file = JSON.parse(LIST) as { designations: unknown[] };
    const small = JSON.stringify({ ...file, designations: file.designations.slice(0, 2) });
    expect(await failure(ingest(listReply(small)))).toMatchObject({ code: 'precondition_failed' });
    expect(await failure(ingest(listReply('{"designations": 1}')))).toMatchObject({
      code: 'precondition_failed',
    });
    expect(await versions()).toEqual(before);
  });

  it('ends with a code that retries when the list cannot be reached, and with none when no address is set', async () => {
    const error = await failure(ingest(() => Promise.reject(new Error('refused 10.0.0.1'))));
    expect(error).toMatchObject({ code: 'internal' });
    expect(JSON.stringify(error)).not.toContain('10.0.0.1');
    await ingest(() => Promise.reject(new Error('never called')), { url: undefined });
    expect(
      await failure(ingest(listReply(), { data: { organisationId: randomUUID() } })),
    ).toMatchObject({
      code: 'invalid_payload',
    });
  });
});

describe('a screening run', () => {
  it('queues the run in the request by ids only, audits it, and matches nothing in the request', async () => {
    const before = await matchesOf(a);
    const run = await startRun(a);
    expect(run).toMatchObject({
      partyId: a.organisation,
      trigger: 'on_demand',
      status: 'queued',
      list: null,
    });
    expect(await matchesOf(a)).toEqual(before);
    const [job] = await jobRows('name = $1 AND data ->> $2 = $3', [
      SCREENING_QUEUE,
      'runId',
      run.id,
    ]);
    expect(job?.data).toEqual({
      runId: run.id,
      tenantId: a.tenant.id,
      requestId: (job?.data as { requestId: string }).requestId,
      causingUserId: a.member,
    });
    const [event] = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.screening_run.started' AND entity_id = $1",
      [run.id],
    );
    expect(event).toMatchObject({
      actor_kind: 'user',
      actor_id: a.member,
      subject_party_id: a.organisation,
    });
  });

  it('answers a replay with the first answer, and queues, writes and audits nothing more', async () => {
    const first = await startRun(a);
    const counts = async () => ({
      runs: await query(a, 'SELECT id FROM assure.screening_run'),
      events: await query(
        a,
        "SELECT id FROM app.audit_event WHERE action LIKE 'assure.screening%'",
      ),
      jobs: await jobRows('name = $1 AND data ->> $2 = $3', [
        SCREENING_QUEUE,
        'tenantId',
        a.tenant.id,
      ]),
    });
    const before = await counts();
    const replay = await as(a, (tx) => routes().replayScreeningRun({ tx, id: first.id }));
    expect(replay).toEqual(first);
    expect(await counts()).toEqual(before);
    for (const id of [null, randomUUID(), 'x']) {
      expect(await failure(as(a, (tx) => routes().replayScreeningRun({ tx, id })))).toMatchObject({
        message: 'not found',
      });
    }
    const theirs = await startRun(b);
    expect(
      await failure(as(a, (tx) => routes().replayScreeningRun({ tx, id: theirs.id }))),
    ).toMatchObject({ message: 'not found' });
  });

  it('raises a match per designation for the organisation, its contact and its officer, and records the list it used', async () => {
    found.length = 0;
    const run = await startRun(a);
    const id = randomUUID();
    await runJob(a, run.id, id);
    const raised = (await matchesOf(a)).filter((match) => match.run_id === run.id);
    expect(raised.map((match) => [match.designation_id, match.name_source]).sort()).toEqual([
      ['TST0001', 'party'],
      ['TST0002', 'officer'],
      ['TST0004', 'party'],
    ]);
    const reordered = raised.find((match) => match.designation_id === 'TST0001');
    expect(Number(reordered?.similarity)).toBe(1);
    expect(reordered?.subject_party_id).toBe(a.contact);
    expect(raised.find((match) => match.designation_id === 'TST0002')?.subject_party_id).toBeNull();
    expect(raised.some((match) => match.designation_id === 'TST0006')).toBe(false);

    const [done] = await query<Record<string, unknown>>(
      a,
      'SELECT * FROM assure.screening_run WHERE id = $1',
      [run.id],
    );
    expect(done).toMatchObject({
      status: 'completed',
      names_screened: 5,
      matches_raised: 3,
      threshold: '0.50',
      error_code: null,
    });
    const [list] = await versions().then((rows) => rows.filter((row) => !row.superseded));
    expect(done?.['list_id']).toBe(list?.id);
    expect(found).toHaveLength(3);
    expect(found.every((event) => event.runId === run.id && event.partyId === a.organisation)).toBe(
      true,
    );
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(['listId', 'matchId', 'partyId', 'runId']);

    const [completed] = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.screening_run.completed' AND entity_id = $1",
      [run.id],
    );
    expect(completed).toMatchObject({
      actor_kind: 'system',
      actor_id: null,
      job_id: id,
      origin_membership_id: a.member,
      subject_party_id: a.organisation,
    });
    const everything = JSON.stringify([
      completed,
      found,
      await jobRows('data ->> $1 = $2', ['tenantId', a.tenant.id]),
    ]);
    for (const name of NAMES) expect(everything).not.toContain(name);
  });

  it('leaves one set of matches when the job is delivered twice', async () => {
    const run = await startRun(a);
    await runJob(a, run.id);
    const once = (await matchesOf(a)).length;
    await runJob(a, run.id);
    expect((await matchesOf(a)).length).toBe(once);
  });

  it('uses the trigram index for the candidate search, and never scans the list table', async () => {
    // On the fixture's eight rows the planner prefers the list's own btree index, so the plan is
    // taken over a generated list of thousands of invented names, as a real list is, and the
    // fixture is loaded again after.
    const letters = (n: number): string =>
      n.toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
    const generated = JSON.stringify({
      publishedOn: '2026-11-17',
      designations: Array.from({ length: 4000 }, (_, i) => ({
        id: `GEN${i}`,
        kind: i % 4 === 0 ? 'entity' : 'individual',
        regime: 'Invented regime generated',
        names: [{ type: 'primary', name: `${letters(i)}ora ${letters(i * 7 + 3)}wick` }],
      })),
    });
    await asOwner(SUPERSEDE_CURRENT);
    try {
      await ingest(listReply(generated));
      await withClient('migrator', (client) => client.query('ANALYZE assure.sanctions_entry'));
      const [live] = (await versions()).filter((row) => !row.superseded);
      const { sql, parameters } = await withTenant(worker, trustedTenantId(a.tenant.id), (trx) =>
        Promise.resolve(
          candidatesQuery(
            trx,
            live?.id ?? '',
            ['individual', 'entity'],
            'zorvan quillbright',
            DEFAULT_THRESHOLD,
            CANDIDATE_CAP,
          ).compile(),
        ),
      );
      const plan = await withRoleClient('app_worker', async (client) => {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL enable_seqscan = off');
          const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, [
            ...parameters,
          ]);
          return rows.map((row) => row['QUERY PLAN']).join('\n');
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(plan).toContain('sanctions_entry_normalised_name_trgm');
      expect(plan).not.toContain('Seq Scan');
    } finally {
      await asOwner(SUPERSEDE_CURRENT);
      await ingest(listReply());
    }
  });

  it('does not raise a designation again once a person decided it was not a match', async () => {
    const [first] = (await matchesOf(a)).filter((match) => match.designation_id === 'TST0004');
    await as(a, (tx, context) =>
      routes().decideScreeningMatch({
        tx,
        context,
        input: {
          params: { matchId: first?.id ?? '' },
          body: { outcome: 'not_a_match', reason: 'different_entity_kind' },
        },
      }),
    );
    const before = (await matchesOf(a)).length;
    const run = await startRun(a);
    await runJob(a, run.id);
    const raised = (await matchesOf(a)).filter((match) => match.run_id === run.id);
    expect(raised.map((match) => match.designation_id).sort()).toEqual(['TST0001', 'TST0002']);
    expect((await matchesOf(a)).length).toBe(before + 2);
  });

  it('is stale when the list was last checked over 48 hours ago, and never says nothing was found when there is none', async () => {
    skew = 3 * 86_400_000;
    const stale = await startRun(a);
    await runJob(a, stale.id);
    skew = 0;
    const read = await as(a, (tx, context) =>
      routes().getScreeningRun({ tx, context, input: { params: { runId: stale.id } } }),
    );
    expect(read).toMatchObject({ status: 'stale_list' });
    await asOwner(SUPERSEDE_CURRENT);
    const none = await startRun(a);
    await runJob(a, none.id);
    const [row] = await query<{ status: string; list_id: string | null; matches_raised: number }>(
      a,
      'SELECT status, list_id, matches_raised FROM assure.screening_run WHERE id = $1',
      [none.id],
    );
    expect(row).toEqual({ status: 'no_list', list_id: null, matches_raised: 0 });
    await ingest(listReply());
  });

  it('never changes a party, an application or any grants table', async () => {
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
    await ingest(listReply());
    const run = await startRun(a);
    await runJob(a, run.id);
    const [open] = (await matchesOf(a)).filter(
      (match) => match.run_id === run.id && match.designation_id === 'TST0001',
    );
    await as(a, (tx, context) =>
      routes().decideScreeningMatch({
        tx,
        context,
        input: {
          params: { matchId: open?.id ?? '' },
          body: { outcome: 'needs_information', reason: 'details_missing' },
        },
      }),
    );
    expect(await tables(a)).toEqual(before);
  });
});

describe('the submission subscriber', () => {
  const envelope = (fixture: Fixture, tenantId: string = fixture.tenant.id) => ({
    id: randomUUID(),
    type: applicationSubmitted.name,
    tenantId,
    sequence: null,
    occurredAt: new Date().toISOString(),
    requestId: randomUUID(),
    causedBy: null,
    data: { organisationId: fixture.organisation, applicantPersonId: fixture.contact },
  });

  const handler = defineEventHandler<unknown>('assure', submissionSubscriber(dependencies));
  const logger = { error: () => undefined };

  /** The delivery as the worker makes it: parsed and tenant-checked by defineEventHandler(). */
  const deliver = (fixture: Fixture, event: unknown, id: string = randomUUID()) =>
    runWorkerJob({ db: worker, sender: workerSender, logger }, handler, {
      id,
      data: {
        event,
        tenantId: fixture.tenant.id,
        requestId: randomUUID(),
        causingUserId: null,
      },
    });

  const runs = (fixture: Fixture) =>
    query<{ trigger: string; status: string; requested_by: string | null }>(
      fixture,
      'SELECT trigger, status, requested_by FROM assure.screening_run ORDER BY created_at DESC',
    );

  it('queues one run for the applicant organisation and screens nothing itself', async () => {
    const before = (await runs(b)).length;
    const id = randomUUID();
    const event = envelope(b);
    expect((await deliver(b, event, id)).status).toBe('completed');
    expect((await deliver(b, event, id)).status).toBe('completed');
    const after = await runs(b);
    expect(after).toHaveLength(before + 1);
    expect(after[0]).toEqual({ trigger: 'submission', status: 'queued', requested_by: null });
    const queued = await jobRows('name = $1 AND data ->> $2 = $3', [
      SCREENING_QUEUE,
      'tenantId',
      b.tenant.id,
    ]);
    expect(JSON.stringify(queued)).not.toContain('Brightwater');
  });

  it('does nothing for a tenant with assure off', async () => {
    expect((await deliver(off, envelope(off))).status).toBe('completed');
    expect(await runs(off)).toEqual([]);
  });

  it('refuses an event that is not valid, with a code', async () => {
    expect(await deliver(b, { type: 'nope' })).toMatchObject({
      status: 'failed',
      output: { code: 'invalid_payload' },
    });
  });

  it("refuses an event whose tenant is not the job's, and queues no run in either tenant", async () => {
    const beforeA = (await runs(a)).length;
    const beforeB = (await runs(b)).length;
    expect(await deliver(b, envelope(a))).toMatchObject({
      status: 'failed',
      output: { code: 'invalid_payload' },
    });
    expect(await deliver(b, envelope(b, a.tenant.id))).toMatchObject({
      status: 'failed',
      output: { code: 'invalid_payload' },
    });
    expect((await runs(a)).length).toBe(beforeA);
    expect((await runs(b)).length).toBe(beforeB);
  });
});

describe('the match routes', () => {
  it('lists matches by ids and codes, oldest first, with no name', async () => {
    const page = await as(a, (tx, context) =>
      routes().listScreeningMatches({ tx, context, input: { query: {} } }),
    );
    expect(page.matches.length).toBeGreaterThan(3);
    expect(page.nextCursor).toBeNull();
    const times = page.matches.map((match) => match.raisedAt);
    expect([...times].sort()).toEqual(times);
    for (const name of NAMES) expect(JSON.stringify(page)).not.toContain(name);
    const open = await as(a, (tx, context) =>
      routes().listScreeningMatches({ tx, context, input: { query: { status: 'open' } } }),
    );
    expect(open.matches.every((match) => match.status === 'open')).toBe(true);
    expect(open.matches.length).toBeLessThan(page.matches.length);
  });

  it('refuses a filter or page link it does not recognise, without echoing it', async () => {
    for (const query of [
      { status: 'bogus' },
      { cursor: 'not a cursor' },
      { cursor: 'YWJj' },
      { extra: 1 },
    ]) {
      const error = await failure(
        as(a, (tx, context) => routes().listScreeningMatches({ tx, context, input: { query } })),
      );
      expect(error).toMatchObject({ status: 400 });
      expect(error?.message).not.toContain('bogus');
    }
  });

  it('shows a match beside its entry and audits the read with the screened party as subject', async () => {
    const [match] = (await matchesOf(a)).filter((row) => row.designation_id === 'TST0001');
    const read = await as(a, (tx, context) =>
      routes().getScreeningMatch({ tx, context, input: { params: { matchId: match?.id ?? '' } } }),
    );
    expect(read).toMatchObject({
      screenedName: 'Quillbright Zorvan',
      entry: {
        designationId: 'TST0001',
        name: 'Zorvan Quillbright',
        datesOfBirth: ['1970-02-03', '1971'],
      },
      list: { publishedOn: '2026-11-16' },
      status: 'open',
      decisions: [],
    });
    const events = await query<Record<string, unknown>>(
      a,
      "SELECT * FROM app.audit_event WHERE action = 'assure.screening_match.viewed' AND entity_id = $1",
      [read.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: a.member, subject_party_id: a.contact });
    for (const name of NAMES) expect(JSON.stringify(events[0])).not.toContain(name);
  });

  const decide = (fixture: Fixture, matchId: string, body: unknown) =>
    as(fixture, (tx, context) =>
      routes().decideScreeningMatch({ tx, context, input: { params: { matchId }, body } }),
    );

  it('records the decision for the member in the session, audits codes only, and a later one supersedes it', async () => {
    const [match] = (await matchesOf(a)).filter((row) => row.designation_id === 'TST0001');
    const first = await decide(a, match?.id ?? '', {
      outcome: 'needs_information',
      reason: 'identity_unclear',
    });
    expect(first).toMatchObject({ outcome: 'needs_information', decidedBy: a.member });
    const second = await decide(a, match?.id ?? '', {
      outcome: 'confirmed',
      reason: 'identity_confirmed',
    });
    const read = await as(a, (tx, context) =>
      routes().getScreeningMatch({ tx, context, input: { params: { matchId: match?.id ?? '' } } }),
    );
    expect(read.status).toBe('confirmed');
    expect(read.decisions.map((decision) => decision.id)).toEqual([first.id, second.id]);
    const [event] = await query<{ changes: unknown; actor_id: string; subject_party_id: string }>(
      a,
      "SELECT changes, actor_id, subject_party_id FROM app.audit_event WHERE action = 'assure.screening_match.decided' ORDER BY occurred_at DESC LIMIT 1",
    );
    expect(event).toMatchObject({ actor_id: a.member, subject_party_id: a.contact });
    expect(JSON.stringify(event?.changes)).toContain('identity_confirmed');
  });

  it('answers a replay of a decision with that decision, and records and audits nothing more', async () => {
    const [match] = (await matchesOf(a)).filter((row) => row.designation_id === 'TST0002');
    const first = await decide(a, match?.id ?? '', {
      outcome: 'not_a_match',
      reason: 'different_name',
    });
    const counts = async () => ({
      decisions: await query(a, 'SELECT id FROM assure.match_decision ORDER BY id'),
      events: await query(
        a,
        "SELECT id FROM app.audit_event WHERE action LIKE 'assure.screening%'",
      ),
    });
    const before = await counts();
    expect(await as(a, (tx) => routes().replayMatchDecision({ tx, id: first.id }))).toEqual(first);
    expect(await counts()).toEqual(before);
    for (const id of [null, randomUUID(), 'x']) {
      expect(await failure(as(a, (tx) => routes().replayMatchDecision({ tx, id })))).toMatchObject({
        message: 'not found',
      });
    }
  });

  it('refuses a body that names a decider or a note, or an outcome and reason that do not fit', async () => {
    const [match] = await matchesOf(a);
    const before = await query<{ n: string }>(a, 'SELECT count(*) AS n FROM assure.match_decision');
    for (const body of [
      { outcome: 'not_a_match', reason: 'different_name', decidedBy: randomUUID() },
      { outcome: 'not_a_match', reason: 'different_name', note: 'free text' },
      { outcome: 'confirmed', reason: 'different_name' },
      { outcome: 'rejected', reason: 'different_name' },
      {},
    ]) {
      expect(await failure(decide(a, match?.id ?? '', body))).toMatchObject({ status: 400 });
    }
    expect(await query(a, 'SELECT count(*) AS n FROM assure.match_decision')).toEqual(before);
  });

  it('refuses anything but not a match for an officer who is not linked to a person', async () => {
    const [officer] = (await matchesOf(a)).filter((row) => row.name_source === 'officer');
    expect(
      await failure(
        decide(a, officer?.id ?? '', { outcome: 'confirmed', reason: 'identity_confirmed' }),
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await decide(a, officer?.id ?? '', { outcome: 'not_a_match', reason: 'different_name' }),
    ).toMatchObject({ outcome: 'not_a_match' });
  });

  it('gives the worker no right to write a decision, and the database refuses it', async () => {
    const [match] = await matchesOf(a);
    const error = await asRoleIn('app_worker', a.tenant.id, (client) =>
      client
        .query(
          `INSERT INTO assure.match_decision (tenant_id, match_id, outcome, reason_code, decided_by)
           VALUES ($1, $2, 'not_a_match', 'different_name', $3)`,
          [a.tenant.id, match?.id, a.member],
        )
        .then(
          () => undefined,
          (cause: unknown) => cause as { code?: string },
        ),
    );
    expect(error?.code).toBe('42501');
  });
});

describe('another tenant', () => {
  it("reads as missing when a run, a match or a decision is asked for from another tenant's session, and sends no job", async () => {
    const run = await startRun(b);
    await runJob(b, run.id);
    const [theirs] = await matchesOf(b);
    expect(theirs).toBeDefined();
    const jobsBefore = (
      await jobRows('name = $1 AND data ->> $2 = $3', [SCREENING_QUEUE, 'tenantId', a.tenant.id])
    ).length;

    expect(await failure(startRun(a, b.organisation))).toMatchObject({ message: 'not found' });
    expect(
      await failure(
        as(a, (tx, context) =>
          routes().getScreeningMatch({
            tx,
            context,
            input: { params: { matchId: theirs?.id ?? '' } },
          }),
        ),
      ),
    ).toMatchObject({ message: 'not found' });
    expect(
      await failure(
        as(a, (tx, context) =>
          routes().decideScreeningMatch({
            tx,
            context,
            input: {
              params: { matchId: theirs?.id ?? '' },
              body: { outcome: 'not_a_match', reason: 'different_name' },
            },
          }),
        ),
      ),
    ).toMatchObject({ message: 'not found' });
    expect(
      await failure(
        as(a, (tx, context) =>
          routes().getScreeningRun({ tx, context, input: { params: { runId: run.id } } }),
        ),
      ),
    ).toMatchObject({ message: 'not found' });
    expect(
      await failure(
        as(a, (tx, context) =>
          routes().listScreeningRuns({
            tx,
            context,
            input: { params: { partyId: b.organisation } },
          }),
        ),
      ),
    ).toMatchObject({ message: 'not found' });

    expect(await query(b, 'SELECT id FROM assure.match_decision')).toEqual([]);
    expect(
      (await jobRows('name = $1 AND data ->> $2 = $3', [SCREENING_QUEUE, 'tenantId', a.tenant.id]))
        .length,
    ).toBe(jobsBefore);
    const page = await as(a, (tx, context) =>
      routes().listScreeningMatches({ tx, context, input: { query: {} } }),
    );
    expect(page.matches.some((match) => match.id === theirs?.id)).toBe(false);
  });

  it("cannot move another tenant's run or add to its matches from a job in its own context", async () => {
    const queued = await startRun(b);
    const before = (await matchesOf(b)).length;
    await runJob(a, queued.id);
    expect(
      await query(b, 'SELECT status FROM assure.screening_run WHERE id = $1', [queued.id]),
    ).toEqual([{ status: 'queued' }]);
    expect((await matchesOf(b)).length).toBe(before);
  });

  it('does nothing when assure is off for the tenant', async () => {
    const [run] = await asMigratorIn(
      off.tenant.id,
      async (client) =>
        (
          await client.query<{ id: string }>(
            "INSERT INTO assure.screening_run (tenant_id, party_id, trigger, requested_by) VALUES ($1, $2, 'on_demand', $3) RETURNING id",
            [off.tenant.id, off.organisation, off.member],
          )
        ).rows,
    );
    await runJob(off, run?.id ?? '');
    expect(await query(off, 'SELECT status FROM assure.screening_run')).toEqual([
      { status: 'queued' },
    ]);
    expect(await matchesOf(off)).toEqual([]);
  });

  it('refuses a job payload that is not a run id', async () => {
    for (const data of [{}, { runId: 'x' }, { runId: randomUUID(), name: 'Zorvan' }]) {
      const error = await failure(
        withTenant(worker, trustedTenantId(a.tenant.id), (trx) =>
          screen(trx, {
            id: randomUUID(),
            data,
            context: { requestId: randomUUID(), causingUserId: null },
          }),
        ),
      );
      expect(error).toMatchObject({ code: 'invalid_payload' });
      expect(error?.message).not.toContain('Zorvan');
    }
  });
});
