// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure routes and jobs through the whole API against the test database:
// sessions, the policy, the module switch, row-level security, replays and the
// audit log, for two tenants, and the jobs as app_worker. The register answers
// from the module's hand-written fixture and the sanctions list is a fixture
// row; nothing calls a live one. The handlers' own rules are tested with assure.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readRegistryKeys } from '@pixel-scientists/assure/server';
import {
  defineHandler,
  startJobSender,
  stopJobSender,
  type JobSender,
} from '@pixel-scientists/db/jobs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { runJob } from '../../../../packages/db/src/jobs/handler.ts';
import { databaseSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  addEntry,
  addList,
  addMatch,
  officerRow,
  snapshotRow,
} from '../../../../packages/db/test/assure/fixtures.ts';
import { jobRows } from '../../../../packages/db/test/jobs/helpers.ts';
import { addOrganisation } from '../../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn, createTestTenant, insertRow } from '../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../test/modules-on.ts';
import { rowsOf } from '../../test/programme-api.ts';
import { addMember, events, versions, type Member } from '../../test/settings-api.ts';
import { expectLooksMissing, smtpTestSettings, testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig, type ModuleSettings } from '../config.ts';
import { openDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules, moduleDependencies } from '../modules.ts';
import { assureComposition } from './assure.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const KEY = 'KEY-sentinel-7f3a9c-assure'; // gitleaks:allow
const CHARITY = '1999001';
const NEW_NAME = 'Quillfeather checklist';

const none: Omit<ModuleSettings, 'assure'> = {
  crm: undefined,
  marketing: undefined,
  forms: undefined,
};
const withoutKeys: ModuleSettings = {
  ...none,
  assure: { registryKeys: {}, sanctionsListUrl: undefined },
};
const withKey: ModuleSettings = {
  ...none,
  assure: {
    registryKeys: readRegistryKeys({ TPS_CHARITY_COMMISSION_API_KEY: KEY }),
    sanctionsListUrl: undefined,
  },
};

const { database: settings } = loadConfig({
  ...process.env,
  ...smtpTestSettings,
  TPS_API_PORT: '41132',
  TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
});
const logger = createLogger({ level: 'silent' });
const database = openDatabase(settings, logger);
const jobs = await database.startJobs(() => undefined);
const auth = testAuth();
const api = await buildApp({
  logger,
  checkDatabase: () => database.check(),
  inTenant: database.inTenant,
  auth: auth.module,
  ...composeModules({ publicTenants: database.publicTenants, jobs, settings: withoutKeys }),
});

const { host, port, database: name, password } = databaseSettings('app_worker', 4);
const worker = createDatabase<unknown>({
  host,
  port,
  database: name,
  password,
  role: 'app_worker',
  maxConnections: 4,
  applicationName: 'tps-api-tests',
});
let workerSender: JobSender;

type Tenant = Awaited<ReturnType<typeof createTestTenant>>;

interface Funder {
  readonly tenant: Tenant;
  readonly officer: Member;
  readonly organisation: string;
  readonly snapshot: string;
  readonly match: string;
  readonly matchParty: string;
}

let a: Funder;
let b: Funder;
let off: Member;
let reviewerA: Member;
let adminA: Member;

async function addFunder(): Promise<Funder> {
  const tenant = await createTestTenant();
  const officer = await addMember(tenant, 'console', 'due_diligence_officer');
  const list = await withClient('migrator', async (client) => {
    const id = await addList(client);
    await addEntry(client, id);
    return id;
  });
  const added = await asMigratorIn(tenant.id, async (client) => {
    const organisation = await addOrganisation(client, tenant, { name: 'Quillfeather Trust' });
    await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisation,
      scheme: 'GB-CHC',
      identifier: CHARITY,
    });
    const snapshot = await insertRow(
      client,
      'assure.lookup_snapshot',
      snapshotRow(tenant, organisation, { identifier: CHARITY }),
    );
    await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot));
    const { match, party } = await addMatch(client, tenant, list);
    return { organisation, snapshot, match, party };
  });
  await switchModule(tenant, 'assure');
  return {
    tenant,
    officer,
    organisation: added.organisation,
    snapshot: added.snapshot,
    match: added.match,
    matchParty: added.party,
  };
}

beforeAll(async () => {
  workerSender = await startJobSender(worker, () => undefined);
  a = await addFunder();
  b = await addFunder();
  const offTenant = await createTestTenant();
  off = await addMember(offTenant, 'console', 'due_diligence_officer');
  reviewerA = await addMember(a.tenant, 'console', 'reviewer');
  adminA = await addMember(a.tenant, 'console', 'tenant_admin');
}, 120_000);

afterAll(async () => {
  await withClient('migrator', async (client) => {
    await client.query('DELETE FROM pgboss.job WHERE name = ANY($1) AND data ->> $2 = ANY($3)', [
      ['assure.registry_refresh', 'assure.screening'],
      'tenantId',
      [a.tenant.id, b.tenant.id],
    ]);
  });
  await stopJobSender(workerSender);
  await api.close();
  await database.close();
  await worker.destroy();
});

type Method = 'GET' | 'POST' | 'PUT';

/** A request as `member`, with an idempotency key on a POST and a recent sign-in when asked. */
const send = (
  member: Member,
  method: Method,
  url: string,
  payload?: unknown,
  { key = randomUUID(), recent = false } = {},
) =>
  api.inject({
    method,
    url: `/api${url}`,
    headers: {
      ...(method === 'POST' ? { 'idempotency-key': key } : {}),
      ...auth.as({
        app: member.app,
        session: testSession({
          app: member.app,
          userId: member.userId,
          tenant: member.tenant.id,
          recentAuthAt: recent ? new Date() : null,
        }),
      }),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function answer<T>(response: ReturnType<typeof send>, status = 200): Promise<T> {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(status);
  return answered.json<T>();
}

const auditRows = (tenant: Tenant, action: string) =>
  rowsOf<{
    entity_id: string;
    actor_kind: string;
    subject_party_id: string | null;
    changes: object;
  }>(
    tenant,
    'SELECT entity_id, actor_kind, subject_party_id, changes FROM app.audit_event WHERE action = $1 ORDER BY occurred_at',
    [action],
  );

describe('who may reach the assure routes', () => {
  it('refuses a member without the permission, and answers 404 for a tenant with assure off', async () => {
    const url = `/console/organisations/${a.organisation}/lookups`;
    expect((await send(reviewerA, 'GET', url)).statusCode).toBe(403);
    expect((await send(reviewerA, 'GET', '/console/checklists')).statusCode).toBe(403);
    expect((await send(reviewerA, 'GET', '/console/screening-matches')).statusCode).toBe(403);
    expect((await send(off, 'GET', '/console/checklists')).statusCode).toBe(404);
  });

  it('refuses a request with no session', async () => {
    const response = await api.inject({ method: 'GET', url: '/api/console/checklists' });
    expect(response.statusCode).toBe(401);
  });
});

describe('registry lookups', () => {
  it('lists the newest snapshot and the registers that are not set up, in the tenant only', async () => {
    const lookups = await answer<{ snapshots: { id: string }[]; notSetUp: string[] }>(
      send(a.officer, 'GET', `/console/organisations/${a.organisation}/lookups`),
    );
    expect(lookups.snapshots.map(({ id }) => id)).toEqual([a.snapshot]);
    expect(lookups.notSetUp).toContain('charity_commission');
    expectLooksMissing(
      await send(b.officer, 'GET', `/console/organisations/${a.organisation}/lookups`),
      await send(b.officer, 'GET', `/console/organisations/${randomUUID()}/lookups`),
    );
  });

  it("audits a read of a snapshot's officers with the organisation as subject, and keeps another tenant out", async () => {
    const url = `/console/lookups/${a.snapshot}/officers`;
    const read = await answer<{ officers: { name: string }[] }>(send(a.officer, 'GET', url));
    expect(read.officers).toHaveLength(1);

    const [event] = await auditRows(a.tenant, 'assure.lookup.officers_viewed');
    expect(event).toMatchObject({ entity_id: a.snapshot, subject_party_id: a.organisation });
    expect(JSON.stringify(event)).not.toContain(read.officers[0]?.name);

    expectLooksMissing(
      await send(b.officer, 'GET', url),
      await send(b.officer, 'GET', `/console/lookups/${randomUUID()}/officers`),
    );
    expect(await auditRows(b.tenant, 'assure.lookup.officers_viewed')).toHaveLength(0);
  });

  it('shows the officers read in the audit log, as it shows other sensitive reads', async () => {
    const found = await answer<{ events: { entityId: string; subjectPartyId: string | null }[] }>(
      send(adminA, 'POST', '/console/audit-events/search', {
        action: 'assure.lookup.officers_viewed',
        subjectPartyId: a.organisation,
      }),
    );
    expect(found.events.map(({ entityId }) => entityId)).toEqual([a.snapshot]);
  });

  it('queues a refresh with ids only, audits the request, and answers a repeated key as already queued', async () => {
    const url = `/console/organisations/${a.organisation}/lookups`;
    const key = randomUUID();
    const queued = await answer<{ jobId: string; registry: string }>(
      send(a.officer, 'POST', url, { registry: 'charity_commission' }, { key }),
      202,
    );

    const [event] = await auditRows(a.tenant, 'assure.lookup.refresh_requested');
    expect(event).toMatchObject({ entity_id: queued.jobId, subject_party_id: a.organisation });
    const [job] = await jobRows(`name = 'assure.registry_refresh' AND data ->> 'tenantId' = $1`, [
      a.tenant.id,
    ]);
    expect(Object.keys(job?.data ?? {}).sort()).toEqual([
      'causingUserId',
      'organisationId',
      'registry',
      'requestId',
      'tenantId',
    ]);

    const again = await send(a.officer, 'POST', url, { registry: 'charity_commission' }, { key });
    expect(again.statusCode).toBe(409);
    expect(await auditRows(a.tenant, 'assure.lookup.refresh_requested')).toHaveLength(1);
  });

  it('refuses a refresh with no register, or one the organisation has no identifier for, and one in another tenant', async () => {
    const url = `/console/organisations/${a.organisation}/lookups`;
    expect((await send(a.officer, 'POST', url, { registry: 'nope' })).statusCode).toBe(400);
    expect((await send(a.officer, 'POST', url, { registry: 'companies_house' })).statusCode).toBe(
      409,
    );
    expect(
      (await send(b.officer, 'POST', url, { registry: 'charity_commission' })).statusCode,
    ).toBe(404);
  });
});

describe('screening runs', () => {
  it('queues a run once for a repeated key, audits it, and keeps it out of other tenants', async () => {
    const url = `/console/parties/${a.organisation}/screening-runs`;
    const key = randomUUID();
    const first = await answer<{ id: string; status: string }>(
      send(a.officer, 'POST', url, undefined, { key }),
      201,
    );
    const again = await answer<{ id: string }>(
      send(a.officer, 'POST', url, undefined, { key }),
      201,
    );

    expect(again.id).toBe(first.id);
    expect(first.status).toBe('queued');
    expect(
      (await auditRows(a.tenant, 'assure.screening_run.started')).filter(
        ({ entity_id: id }) => id === first.id,
      ),
    ).toEqual([expect.objectContaining({ subject_party_id: a.organisation })]);
    const listed = await answer<{ runs: { id: string }[] }>(send(a.officer, 'GET', url));
    expect(listed.runs.map(({ id }) => id)).toContain(first.id);

    expect((await send(b.officer, 'POST', url)).statusCode).toBe(404);
    expect((await send(b.officer, 'GET', url)).statusCode).toBe(404);
    expect((await send(b.officer, 'GET', `/console/screening-runs/${first.id}`)).statusCode).toBe(
      404,
    );
  });

  it('refuses a member who may not run screening', async () => {
    const url = `/console/parties/${a.organisation}/screening-runs`;
    expect((await send(reviewerA, 'POST', url)).statusCode).toBe(403);
  });
});

describe('possible matches', () => {
  it('lists the tenant’s matches by ids and codes, without a name', async () => {
    const page = await answer<{ matches: { id: string }[] }>(
      send(a.officer, 'GET', '/console/screening-matches'),
    );
    expect(page.matches.map(({ id }) => id)).toEqual([a.match]);
    expect(JSON.stringify(page)).not.toContain('Synthetic Screened Name');
    const theirs = await answer<{ matches: { id: string }[] }>(
      send(b.officer, 'GET', '/console/screening-matches'),
    );
    expect(theirs.matches.map(({ id }) => id)).toEqual([b.match]);
  });

  it('audits a read of a match beside its entry, and answers another tenant’s as missing', async () => {
    const url = `/console/screening-matches/${a.match}`;
    const read = await answer<{ screenedName: string }>(send(a.officer, 'GET', url));
    expect(read.screenedName).toBe('Synthetic Screened Name');
    expect(await auditRows(a.tenant, 'assure.screening_match.viewed')).toEqual([
      expect.objectContaining({ entity_id: a.match, subject_party_id: a.matchParty }),
    ]);

    expectLooksMissing(
      await send(b.officer, 'GET', url),
      await send(b.officer, 'GET', `/console/screening-matches/${randomUUID()}`),
    );
    expect(await auditRows(b.tenant, 'assure.screening_match.viewed')).toHaveLength(0);
  });

  it('records a decision only for a named member who signed in again, once for a repeated key', async () => {
    const url = `/console/screening-matches/${a.match}/decisions`;
    const body = { outcome: 'not_a_match', reason: 'different_name' };

    const stale = await send(a.officer, 'POST', url, body);
    expect(stale.statusCode).toBe(403);
    expect((await send(reviewerA, 'POST', url, body, { recent: true })).statusCode).toBe(403);
    expect(
      (
        await send(
          a.officer,
          'POST',
          url,
          { ...body, reason: 'identity_confirmed' },
          { recent: true },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await send(a.officer, 'POST', url, { ...body, decidedBy: randomUUID() }, { recent: true }))
        .statusCode,
    ).toBe(400);
    expect((await send(b.officer, 'POST', url, body, { recent: true })).statusCode).toBe(404);

    const key = randomUUID();
    const first = await answer<{ id: string; decidedBy: string }>(
      send(a.officer, 'POST', url, body, { key, recent: true }),
      201,
    );
    const again = await answer<{ id: string }>(
      send(a.officer, 'POST', url, body, { key, recent: true }),
      201,
    );
    expect(again.id).toBe(first.id);
    expect(first.decidedBy).toBe(a.officer.membershipId);
    expect(await auditRows(a.tenant, 'assure.screening_match.decided')).toHaveLength(1);
  });
});

describe('duplicate flags', () => {
  it('lists a party’s flags in the tenant only', async () => {
    const url = `/console/parties/${a.organisation}/duplicate-flags`;
    const flags = await answer<{ flags: unknown[] }>(send(a.officer, 'GET', url));
    expect(Array.isArray(flags.flags)).toBe(true);
    expect((await send(b.officer, 'GET', url)).statusCode).toBe(404);
    expect(
      (await send(a.officer, 'GET', `/console/applications/${randomUUID()}/duplicate-flags`))
        .statusCode,
    ).toBe(404);
    expect((await send(reviewerA, 'GET', url)).statusCode).toBe(403);
  });
});

describe('checklists', () => {
  const item = { id: randomUUID(), label: 'Accounts checked', kind: 'yes_no', required: true };

  it('creates a checklist once for a repeated key, records its configuration version and audit event', async () => {
    const key = randomUUID();
    const body = { name: NEW_NAME, items: [item] };
    const first = await answer<{ id: string; version: { number: number } }>(
      send(a.officer, 'POST', '/console/checklists', body, { key }),
      201,
    );
    const again = await answer<{ id: string }>(
      send(a.officer, 'POST', '/console/checklists', body, { key }),
      201,
    );

    expect(again.id).toBe(first.id);
    expect((await versions(a.tenant, 'assure.checklist')).map(({ entity_id: id }) => id)).toEqual([
      first.id,
    ]);
    expect(
      (await events(a.tenant, 'assure.checklist.created')).map(({ entity_id: id }) => id),
    ).toEqual([first.id]);

    const listed = await answer<{ checklists: { id: string; name: string }[] }>(
      send(a.officer, 'GET', '/console/checklists'),
    );
    expect(listed.checklists.map(({ id }) => id)).toContain(first.id);
    expect(
      (await answer<{ checklists: unknown[] }>(send(b.officer, 'GET', '/console/checklists')))
        .checklists.length,
    ).toBe(0);
    expectLooksMissing(
      await send(b.officer, 'GET', `/console/checklists/${first.id}`),
      await send(b.officer, 'GET', `/console/checklists/${randomUUID()}`),
    );
  });

  it('publishes a new version, and refuses a change for another tenant or a member who may not manage', async () => {
    const created = await answer<{ id: string }>(
      send(a.officer, 'POST', '/console/checklists', {
        name: `${NEW_NAME} two`,
        items: [item],
      }),
      201,
    );
    const url = `/console/checklists/${created.id}/versions`;
    const body = {
      name: `${NEW_NAME} two`,
      items: [item, { ...item, id: randomUUID(), label: 'Policies seen' }],
    };

    expect((await send(reviewerA, 'POST', url, body)).statusCode).toBe(403);
    expect((await send(b.officer, 'POST', url, body)).statusCode).toBe(404);
    const published = await answer<{ version: { number: number } }>(
      send(a.officer, 'POST', url, body),
      201,
    );
    expect(published.version.number).toBe(2);
    expect(
      (await events(a.tenant, 'assure.checklist.published')).map(({ entity_id: id }) => id),
    ).toEqual([created.id]);
  });
});

describe('the jobs', () => {
  const fixture = readFileSync(
    new URL(
      '../../../../modules/assure/src/server/registries/fixtures/charity-commission.json',
      import.meta.url,
    ),
    'utf8',
  );

  /** Runs the named queue's job as the worker would, in the tenant, through the wrapper that checks its payload. */
  async function work(
    settingsFor: ModuleSettings,
    queue: string,
    tenant: Tenant,
    data: Record<string, unknown>,
    causingUserId: string | null = null,
  ) {
    const found = assureComposition(
      moduleDependencies({ jobs: workerSender, settings: settingsFor }),
    ).jobs?.find((job) => job.queue.name === queue);
    if (found === undefined) throw new Error(`No job for ${queue}.`);
    return runJob(
      { db: worker, sender: workerSender, logger: { error: () => undefined } },
      defineHandler<unknown, z.ZodObject, 'tenant'>(found.queue, found.handler),
      {
        id: randomUUID(),
        data: { ...data, tenantId: tenant.id, requestId: randomUUID(), causingUserId },
      },
    );
  }

  const snapshots = async (tenant: Tenant) =>
    Number(
      (await rowsOf<{ n: string }>(tenant, 'SELECT count(*) AS n FROM assure.lookup_snapshot'))[0]
        ?.n,
    );

  it('refreshes a lookup through the outbound client when the register has a key, and audits it as the system', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(fixture, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    try {
      const before = await snapshots(a.tenant);
      const result = await work(
        withKey,
        'assure.registry_refresh',
        a.tenant,
        { organisationId: a.organisation, registry: 'charity_commission' },
        a.officer.membershipId,
      );

      expect(result.status).toBe('completed');
      expect(calls.length).toBeGreaterThan(0);
      expect(await snapshots(a.tenant)).toBe(before + 1);
      const refreshed = await auditRows(a.tenant, 'assure.lookup.refreshed');
      expect(refreshed.at(-1)).toMatchObject({
        actor_kind: 'system',
        subject_party_id: a.organisation,
      });
      expect(await snapshots(b.tenant)).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ends a refresh with a code and calls no register when the key is not set', async () => {
    const stub = vi.fn();
    vi.stubGlobal('fetch', stub);
    try {
      const before = await snapshots(a.tenant);
      const result = await work(withoutKeys, 'assure.registry_refresh', a.tenant, {
        organisationId: a.organisation,
        registry: 'charity_commission',
      });

      expect(result).toMatchObject({ status: 'failed', output: { code: 'precondition_failed' } });
      expect(stub).not.toHaveBeenCalled();
      expect(await snapshots(a.tenant)).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a payload with a name or another tenant’s id in it', async () => {
    const result = await work(withKey, 'assure.registry_refresh', a.tenant, {
      organisationId: a.organisation,
      registry: 'charity_commission',
      name: 'Quillfeather Trust',
    });
    expect(result).toMatchObject({ status: 'failed', output: { code: 'invalid_payload' } });
  });

  it('moves a queued screening run on, and audits its end as the system', async () => {
    const run = await answer<{ id: string }>(
      send(a.officer, 'POST', `/console/parties/${a.organisation}/screening-runs`),
      201,
    );
    const result = await work(
      withoutKeys,
      'assure.screening',
      a.tenant,
      { runId: run.id },
      a.officer.membershipId,
    );

    expect(result.status).toBe('completed');
    const read = await answer<{ status: string }>(
      send(a.officer, 'GET', `/console/screening-runs/${run.id}`),
    );
    expect(read.status).not.toBe('queued');
    const completed = (await auditRows(a.tenant, 'assure.screening_run.completed')).filter(
      ({ entity_id: id }) => id === run.id,
    );
    expect(completed).toEqual([expect.objectContaining({ actor_kind: 'system' })]);
    // Another tenant's run is not there for this tenant's job: it ends having done nothing.
    const other = await answer<{ id: string }>(
      send(b.officer, 'POST', `/console/parties/${b.organisation}/screening-runs`),
      201,
    );
    await work(withoutKeys, 'assure.screening', a.tenant, { runId: other.id });
    expect(
      (await send(b.officer, 'GET', `/console/screening-runs/${other.id}`)).json<{
        status: string;
      }>().status,
    ).toBe('queued');
  });

  it('starts a screening run for the applicant organisation when an application is submitted, once per delivery', async () => {
    const envelope = {
      id: randomUUID(),
      type: 'grants.application_submitted.v1',
      tenantId: a.tenant.id,
      sequence: 1,
      occurredAt: new Date().toISOString(),
      requestId: randomUUID(),
      causedBy: null,
      data: {
        applicationId: randomUUID(),
        roundId: randomUUID(),
        programmeId: randomUUID(),
        organisationId: a.organisation,
        applicantPersonId: randomUUID(),
        route: 'portal',
        timing: 'on_time',
        submittedAt: new Date().toISOString(),
      },
    };
    const runs = async () =>
      Number(
        (
          await rowsOf<{ n: string }>(
            a.tenant,
            `SELECT count(*) AS n FROM assure.screening_run WHERE trigger = 'submission' AND party_id = $1`,
            [a.organisation],
          )
        )[0]?.n,
      );

    const before = await runs();
    const first = await work(withoutKeys, 'events.assure', a.tenant, { event: envelope });
    expect(first.status).toBe('completed');
    expect(await runs()).toBe(before + 1);

    const crossed = await work(withoutKeys, 'events.assure', b.tenant, { event: envelope });
    expect(crossed).toMatchObject({ status: 'failed', output: { code: 'invalid_payload' } });
  });
});
