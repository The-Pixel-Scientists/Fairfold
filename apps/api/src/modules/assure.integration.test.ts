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
import {
  addApplication,
  addFile,
  submit,
} from '../../../../packages/db/test/grants/application-fixtures.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
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

/** A submitted application in `tenant`, with the organisation and person it is from. */
async function addSubmitted(tenant: Tenant) {
  return asMigratorIn(tenant.id, async (client) => {
    const { id, parts } = await addApplication(client, tenant);
    await submit(client, id, parts.stages[0]);
    return { application: id, organisation: parts.organisation, person: parts.person };
  });
}

const cleanFile = (funder: Funder) =>
  asMigratorIn(funder.tenant.id, (client) =>
    addFile(client, funder.tenant, funder.officer.membershipId),
  );

const fileState = async (funder: Funder, file: string) =>
  (
    await rowsOf<{ linked: boolean; released: boolean }>(
      funder.tenant,
      'SELECT linked_at IS NOT NULL AS linked, released_at IS NOT NULL AS released FROM app.file WHERE id = $1',
      [file],
    )
  )[0];

describe('linking an officer to a person', () => {
  const link = (officer: string) => `/console/lookup-officers/${officer}/link`;
  let officer: string;
  let person: string;
  let stranger: string;

  beforeAll(async () => {
    officer = String(
      (
        await rowsOf<{ id: string }>(
          a.tenant,
          'SELECT id FROM assure.lookup_officer WHERE snapshot_id = $1',
          [a.snapshot],
        )
      )[0]?.id,
    );
    person = await asMigratorIn(a.tenant.id, (client) => addPerson(client, a.tenant));
    stranger = await asMigratorIn(b.tenant.id, (client) => addPerson(client, b.tenant));
  });

  it('refuses a member without the permission, another tenant’s officer and a body it cannot trust, and links nothing', async () => {
    const body = { personId: person };
    expect((await send(reviewerA, 'POST', link(officer), body)).statusCode).toBe(403);
    expectLooksMissing(
      await send(b.officer, 'POST', link(officer), { personId: stranger }),
      await send(b.officer, 'POST', link(randomUUID()), { personId: stranger }),
    );
    expect(
      (await send(a.officer, 'POST', link(officer), { ...body, linkedBy: randomUUID() }))
        .statusCode,
    ).toBe(400);
    expect((await send(a.officer, 'POST', link(officer), { personId: 'nope' })).statusCode).toBe(
      400,
    );
    // Another tenant's person, and a party that is an organisation, are not people of this tenant.
    expect((await send(a.officer, 'POST', link(officer), { personId: stranger })).statusCode).toBe(
      400,
    );
    expect(
      (await send(a.officer, 'POST', link(officer), { personId: a.organisation })).statusCode,
    ).toBe(400);
    const [row] = await rowsOf<{ person_id: string | null }>(
      a.tenant,
      'SELECT person_id FROM assure.lookup_officer WHERE id = $1',
      [officer],
    );
    expect(row?.person_id).toBeNull();
    expect(await auditRows(a.tenant, 'assure.lookup_officer.linked')).toHaveLength(0);
  });

  it('links the officer as the member in the session, once, and audits the person as the subject', async () => {
    const linked = await answer<{ id: string; personId: string }>(
      send(a.officer, 'POST', link(officer), { personId: person }),
    );
    expect(linked).toMatchObject({ id: officer, personId: person });
    expect(await auditRows(a.tenant, 'assure.lookup_officer.linked')).toEqual([
      expect.objectContaining({ entity_id: officer, subject_party_id: person }),
    ]);
    const [row] = await rowsOf<{ linked_by: string; linked_at: Date }>(
      a.tenant,
      'SELECT linked_by, linked_at FROM assure.lookup_officer WHERE id = $1',
      [officer],
    );
    expect(row?.linked_by).toBe(a.officer.membershipId);
    expect(row?.linked_at).toBeInstanceOf(Date);

    const again = await send(a.officer, 'POST', link(officer), { personId: person });
    expect(again.statusCode).toBe(409);
    expect(await auditRows(a.tenant, 'assure.lookup_officer.linked')).toHaveLength(1);
    const read = await answer<{ officers: { personId: string | null }[] }>(
      send(a.officer, 'GET', `/console/lookups/${a.snapshot}/officers`),
    );
    expect(read.officers.map(({ personId }) => personId)).toEqual([person]);
  });
});

describe('dismissing a duplicate flag', () => {
  let twin: string;
  let flag: { id: string; signal: string; dismissal: unknown };

  beforeAll(async () => {
    twin = await asMigratorIn(a.tenant.id, (client) =>
      addOrganisation(client, a.tenant, { name: 'Quillfeather Trust' }),
    );
  });

  const flagsOf = async (party: string) =>
    (
      await answer<{ flags: (typeof flag)[] }>(
        send(a.officer, 'GET', `/console/parties/${party}/duplicate-flags`),
      )
    ).flags;
  const dismissal = (id: string) => `/console/duplicate-flags/${id}/dismissal`;

  it('lists a flag under one id whichever of the two parties it is listed for', async () => {
    const [mine] = await flagsOf(a.organisation);
    const [theirs] = await flagsOf(twin);
    expect(mine).toMatchObject({ signal: 'similar_name', dismissal: null });
    expect(theirs?.id).toBe(mine?.id);
    flag = mine as typeof flag;
    const rows = await rowsOf<{ n: string }>(
      a.tenant,
      'SELECT count(*) AS n FROM assure.duplicate_flag',
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('refuses a member without the permission, another tenant, a reason outside the list and a body it cannot trust', async () => {
    const body = { reason: 'different_organisation' };
    expect((await send(reviewerA, 'POST', dismissal(flag.id), body)).statusCode).toBe(403);
    expectLooksMissing(
      await send(b.officer, 'POST', dismissal(flag.id), body),
      await send(b.officer, 'POST', dismissal(randomUUID()), body),
    );
    expect((await send(a.officer, 'POST', dismissal(flag.id), { reason: 'tidy' })).statusCode).toBe(
      400,
    );
    expect(
      (await send(a.officer, 'POST', dismissal(flag.id), { ...body, dismissedBy: randomUUID() }))
        .statusCode,
    ).toBe(400);
    expect((await flagsOf(a.organisation))[0]?.dismissal).toBeNull();
    expect(await auditRows(a.tenant, 'assure.duplicate_flag.dismissed')).toHaveLength(0);
  });

  it('dismisses it once as the member in the session, keeps it dismissed on both parties, and audits a code', async () => {
    const dismissed = await answer<{ dismissal: { reason: string; dismissedBy: string } }>(
      send(a.officer, 'POST', dismissal(flag.id), { reason: 'different_organisation' }),
    );
    expect(dismissed.dismissal).toMatchObject({
      reason: 'different_organisation',
      dismissedBy: a.officer.membershipId,
    });
    expect(
      (await send(a.officer, 'POST', dismissal(flag.id), { reason: 'different_organisation' }))
        .statusCode,
    ).toBe(409);
    expect((await flagsOf(a.organisation))[0]?.dismissal).toMatchObject({
      reason: 'different_organisation',
    });
    expect((await flagsOf(twin))[0]?.dismissal).toMatchObject({ reason: 'different_organisation' });
    const [event] = await auditRows(a.tenant, 'assure.duplicate_flag.dismissed');
    expect(event).toMatchObject({ entity_id: flag.id });
    expect([a.organisation, twin]).toContain(event?.subject_party_id);
    expect(JSON.stringify(event)).toContain('different_organisation');
    expect(await auditRows(b.tenant, 'assure.duplicate_flag.dismissed')).toHaveLength(0);
  });
});

describe('checklist answers', () => {
  const NOTE = 'Quillfeather accounts filed late';
  let checklist: { id: string; version: { id: string; items: { id: string; kind: string }[] } };
  let applied: Awaited<ReturnType<typeof addSubmitted>>;
  let draft: string;
  let url: string;

  const itemOf = (kind: string) => {
    const found = checklist.version.items.find((item) => item.kind === kind);
    if (found === undefined) throw new Error(`No ${kind} item.`);
    return found.id;
  };
  const answers = (file: string, change: object = {}) => ({
    versionId: checklist.version.id,
    answers: {
      [itemOf('yes_no')]: { kind: 'yes_no', value: 'yes' },
      [itemOf('short_text')]: { kind: 'short_text', value: NOTE },
      [itemOf('file')]: { kind: 'file', fileIds: [file] },
    },
    ...change,
  });
  const stored = async () =>
    Number(
      (
        await rowsOf<{ n: string }>(a.tenant, 'SELECT count(*) AS n FROM assure.checklist_response')
      )[0]?.n,
    );

  beforeAll(async () => {
    applied = await addSubmitted(a.tenant);
    draft = await asMigratorIn(
      a.tenant.id,
      async (client) => (await addApplication(client, a.tenant)).id,
    );
    await switchModule(a.tenant, 'grants');
    await switchModule(b.tenant, 'grants');
    checklist = await answer<typeof checklist>(
      send(a.officer, 'POST', '/console/checklists', {
        name: 'Answers checklist',
        items: [
          { id: randomUUID(), label: 'Accounts checked', kind: 'yes_no', required: true },
          { id: randomUUID(), label: 'Visit date', kind: 'date', required: false },
          { id: randomUUID(), label: 'Notes', kind: 'short_text', required: false },
          { id: randomUUID(), label: 'Evidence', kind: 'file', required: true },
        ],
      }),
      201,
    );
    url = `/console/applications/${applied.application}/checklists/${checklist.id}`;
  }, 60_000);

  it('refuses a member without the permission, another tenant, a draft and an unknown checklist', async () => {
    const list = `/console/applications/${applied.application}/checklists`;
    expect((await send(reviewerA, 'GET', url)).statusCode).toBe(403);
    expect((await send(reviewerA, 'PUT', url, answers(randomUUID()))).statusCode).toBe(403);
    expect((await send(reviewerA, 'GET', list)).statusCode).toBe(403);
    expectLooksMissing(
      await send(b.officer, 'GET', list),
      await send(b.officer, 'GET', `/console/applications/${randomUUID()}/checklists`),
    );
    expectLooksMissing(
      await send(b.officer, 'GET', url),
      await send(
        b.officer,
        'GET',
        `/console/applications/${randomUUID()}/checklists/${randomUUID()}`,
      ),
    );
    expect((await send(b.officer, 'PUT', url, answers(randomUUID()))).statusCode).toBe(404);
    expect(
      (await send(a.officer, 'GET', `/console/applications/${draft}/checklists/${checklist.id}`))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await send(
          a.officer,
          'GET',
          `/console/applications/${applied.application}/checklists/${randomUUID()}`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('reads the newest version with no answers before the first save, without an audit event', async () => {
    const read = await answer<{
      version: { id: string };
      answers: object;
      savedAt: unknown;
      complete: boolean;
    }>(send(a.officer, 'GET', url));
    expect(read).toMatchObject({ answers: {}, savedAt: null, complete: false });
    expect(read.version.id).toBe(checklist.version.id);
    const listed = await answer<{ checklists: { checklistId: string; complete: boolean }[] }>(
      send(a.officer, 'GET', `/console/applications/${applied.application}/checklists`),
    );
    expect(listed.checklists).toContainEqual(
      expect.objectContaining({ checklistId: checklist.id, complete: false }),
    );
    expect(await auditRows(a.tenant, 'assure.checklist_response.viewed')).toHaveLength(0);
  });

  it('refuses answers that do not fit the version, a file that cannot be linked and a body it cannot trust, saving nothing', async () => {
    const file = await cleanFile(a);
    const infected = await asMigratorIn(a.tenant.id, (client) =>
      addFile(client, a.tenant, a.officer.membershipId, 'infected'),
    );
    const theirs = await cleanFile(b);
    const mismatched = answers(file, {
      answers: { [itemOf('yes_no')]: { kind: 'date', value: '2026-11-02' } },
    });
    const unknown = answers(file, {
      answers: { [randomUUID()]: { kind: 'yes_no', value: 'yes' } },
    });
    for (const body of [
      mismatched,
      unknown,
      answers(infected),
      answers(theirs),
      { ...answers(file), savedBy: randomUUID() },
    ]) {
      expect((await send(a.officer, 'PUT', url, body)).statusCode).toBe(400);
    }
    expect(
      (await send(a.officer, 'PUT', url, answers(file, { versionId: randomUUID() }))).statusCode,
    ).toBe(409);
    expect(await stored()).toBe(0);
    expect(await fileState(a, file)).toEqual({ linked: false, released: false });
    expect(await fileState(b, theirs)).toEqual({ linked: false, released: false });
  });

  it('saves the answers, links the file and audits the applicant as the subject without an answer', async () => {
    const file = await cleanFile(a);
    const saved = await answer<{
      complete: boolean;
      savedAt: string;
      answers: Record<string, unknown>;
    }>(send(a.officer, 'PUT', url, answers(file)));
    expect(saved.complete).toBe(true);
    expect(saved.answers[itemOf('file')]).toEqual({ kind: 'file', fileIds: [file] });
    expect(saved.answers[itemOf('short_text')]).toEqual({ kind: 'short_text', value: NOTE });
    expect(await fileState(a, file)).toEqual({ linked: true, released: false });
    const events = await auditRows(a.tenant, 'assure.checklist_response.saved');
    expect(events).toEqual([expect.objectContaining({ subject_party_id: applied.person })]);
    expect(JSON.stringify(events)).not.toContain(NOTE);
    expect(await auditRows(b.tenant, 'assure.checklist_response.saved')).toHaveLength(0);

    // The same answers again keep the file's link, and a replaced file is released.
    await answer(send(a.officer, 'PUT', url, answers(file)));
    expect(await fileState(a, file)).toEqual({ linked: true, released: false });
    const next = await cleanFile(a);
    await answer(send(a.officer, 'PUT', url, answers(next)));
    expect(await fileState(a, file)).toEqual({ linked: true, released: true });
    expect(await fileState(a, next)).toEqual({ linked: true, released: false });
    expect((await send(a.officer, 'PUT', url, answers(file))).statusCode).toBe(400);
  });

  it('audits a read of saved answers, and shows another tenant nothing', async () => {
    const read = await answer<{ answers: Record<string, unknown> }>(send(a.officer, 'GET', url));
    expect(Object.keys(read.answers)).toHaveLength(3);
    expect(await auditRows(a.tenant, 'assure.checklist_response.viewed')).toEqual([
      expect.objectContaining({ subject_party_id: applied.person }),
    ]);
    expect((await send(b.officer, 'GET', url)).statusCode).toBe(404);
    expect(await auditRows(b.tenant, 'assure.checklist_response.viewed')).toHaveLength(0);
    const listed = await answer<{ checklists: { checklistId: string; complete: boolean }[] }>(
      send(a.officer, 'GET', `/console/applications/${applied.application}/checklists`),
    );
    expect(listed.checklists).toContainEqual(
      expect.objectContaining({ checklistId: checklist.id, complete: true }),
    );
  });

  it('keeps answers on the version they were saved against, and answers 409 for another', async () => {
    const published = await answer<{ version: { id: string } }>(
      send(a.officer, 'POST', `/console/checklists/${checklist.id}/versions`, {
        name: 'Answers checklist',
        items: checklist.version.items.map((item, position) => ({
          ...item,
          label: `Question ${String(position)}`,
          help: '',
          required: false,
        })),
      }),
      201,
    );
    expect(published.version.id).not.toBe(checklist.version.id);
    const next = await cleanFile(a);
    expect(
      (await send(a.officer, 'PUT', url, answers(next, { versionId: published.version.id })))
        .statusCode,
    ).toBe(409);
    const read = await answer<{ version: { id: string } }>(send(a.officer, 'GET', url));
    expect(read.version.id).toBe(checklist.version.id);
  });
});

describe('monitoring visits', () => {
  let applied: Awaited<ReturnType<typeof addSubmitted>>;
  let other: Awaited<ReturnType<typeof addSubmitted>>;
  let attendee: string;
  let spare: string;
  let visit: { id: string };

  const body = (change: object = {}) => ({
    organisationId: applied.organisation,
    applicationId: applied.application,
    visitedOn: '2026-11-02',
    type: 'in_person',
    attendeePersonIds: [attendee],
    findings: 'The trustees showed us the accounts.',
    followUps: [{ action: 'Send the accounts', dueOn: '2026-12-01', done: false }],
    evidence: [] as { fileId: string; caption: string }[],
    ...change,
  });

  beforeAll(async () => {
    applied = await addSubmitted(a.tenant);
    other = await addSubmitted(a.tenant);
    attendee = await asMigratorIn(a.tenant.id, (client) => addPerson(client, a.tenant));
    spare = await asMigratorIn(b.tenant.id, (client) => addPerson(client, b.tenant));
    await switchModule(a.tenant, 'grants');
  }, 60_000);

  it('refuses a member without the permission, and records nothing for records outside the tenant or the organisation', async () => {
    expect((await send(reviewerA, 'POST', '/console/visits', body())).statusCode).toBe(403);
    expect((await send(reviewerA, 'GET', '/console/visits')).statusCode).toBe(403);
    const file = await cleanFile(a);
    const infected = await asMigratorIn(a.tenant.id, (client) =>
      addFile(client, a.tenant, a.officer.membershipId, 'infected'),
    );
    for (const refused of [
      body({ organisationId: b.organisation }),
      body({ applicationId: other.application }),
      body({ applicationId: randomUUID() }),
      body({ attendeePersonIds: [spare] }),
      body({ attendeePersonIds: [applied.organisation] }),
      body({ evidence: [{ fileId: infected, caption: 'Accounts' }] }),
      body({ type: 'carrier_pigeon' }),
      { ...body(), recordedBy: randomUUID() },
    ]) {
      expect((await send(a.officer, 'POST', '/console/visits', refused)).statusCode).toBe(400);
    }
    expect(
      (await send(b.officer, 'POST', '/console/visits', body({ attendeePersonIds: [spare] })))
        .statusCode,
    ).toBe(400);
    expect(await auditRows(a.tenant, 'assure.visit.recorded')).toHaveLength(0);
    expect(await fileState(a, file)).toEqual({ linked: false, released: false });
  });

  it('records a visit once for a repeated key, links its evidence and audits the organisation without findings', async () => {
    const file = await cleanFile(a);
    const key = randomUUID();
    const payload = body({ evidence: [{ fileId: file, caption: 'Accounts 2025' }] });
    visit = await answer(send(a.officer, 'POST', '/console/visits', payload, { key }), 201);
    const again = await answer<{ id: string }>(
      send(a.officer, 'POST', '/console/visits', payload, { key }),
      201,
    );

    expect(again.id).toBe(visit.id);
    expect(visit).toMatchObject({
      organisationId: applied.organisation,
      applicationId: applied.application,
      visitedOn: '2026-11-02',
      attendeePersonIds: [attendee],
      evidence: [{ fileId: file, caption: 'Accounts 2025' }],
    });
    expect(await fileState(a, file)).toEqual({ linked: true, released: false });
    const events = await auditRows(a.tenant, 'assure.visit.recorded');
    expect(events).toEqual([
      expect.objectContaining({ entity_id: visit.id, subject_party_id: applied.organisation }),
    ]);
    expect(JSON.stringify(events)).not.toContain('trustees');
  });

  it('audits a read of a visit with its findings, and answers another tenant as missing', async () => {
    const url = `/console/visits/${visit.id}`;
    const read = await answer<{ findings: string }>(send(a.officer, 'GET', url));
    expect(read.findings).toContain('trustees');
    expect(await auditRows(a.tenant, 'assure.visit.viewed')).toEqual([
      expect.objectContaining({ entity_id: visit.id, subject_party_id: applied.organisation }),
    ]);
    expectLooksMissing(
      await send(b.officer, 'GET', url),
      await send(b.officer, 'GET', `/console/visits/${randomUUID()}`),
    );
    expect(await auditRows(b.tenant, 'assure.visit.viewed')).toHaveLength(0);
  });

  it('changes a visit, keeping its organisation, and releases evidence it drops', async () => {
    const url = `/console/visits/${visit.id}`;
    const kept = visit as unknown as { evidence: { fileId: string }[] };
    const [first] = kept.evidence;
    const added = await cleanFile(a);
    const update = {
      visitedOn: '2026-11-03',
      type: 'video_call',
      attendeePersonIds: [],
      findings: 'Everything was in order.',
      followUps: [{ action: 'Send the accounts', dueOn: null, done: true }],
      evidence: [{ fileId: added, caption: 'Signed report' }],
    };
    expect((await send(reviewerA, 'PUT', url, update)).statusCode).toBe(403);
    expect((await send(b.officer, 'PUT', url, update)).statusCode).toBe(404);
    expect(
      (await send(a.officer, 'PUT', url, { ...update, organisationId: randomUUID() })).statusCode,
    ).toBe(400);

    const changed = await answer<{
      organisationId: string;
      visitedOn: string;
      attendeePersonIds: string[];
      evidence: { fileId: string; caption: string }[];
    }>(send(a.officer, 'PUT', url, update));
    expect(changed).toMatchObject({
      organisationId: applied.organisation,
      visitedOn: '2026-11-03',
      attendeePersonIds: [],
      evidence: [{ fileId: added, caption: 'Signed report' }],
    });
    expect(await fileState(a, String(first?.fileId))).toEqual({ linked: true, released: true });
    expect(await auditRows(a.tenant, 'assure.visit.updated')).toEqual([
      expect.objectContaining({ entity_id: visit.id, subject_party_id: applied.organisation }),
    ]);
    expect(await auditRows(b.tenant, 'assure.visit.updated')).toHaveLength(0);
  });

  it('lists visits newest first a page at a time, counts open follow-ups and keeps other tenants out', async () => {
    const only = await answer<{
      visits: { id: string; openFollowUps: number }[];
      nextCursor: null;
    }>(send(a.officer, 'GET', `/console/visits?applicationId=${applied.application}`));
    expect(only.visits).toEqual([expect.objectContaining({ id: visit.id, openFollowUps: 0 })]);

    await asMigratorIn(a.tenant.id, (client) =>
      client.query(
        `INSERT INTO assure.monitoring_visit
           (tenant_id, organisation_id, visited_on, visit_type, recorded_by, updated_by)
         SELECT $1::uuid, $2::uuid, DATE '2026-01-01' + n, 'phone_call', $3::uuid, $3::uuid FROM generate_series(1, 51) AS n`,
        [a.tenant.id, other.organisation, a.officer.membershipId],
      ),
    );
    const url = `/console/visits?organisationId=${other.organisation}`;
    const first = await answer<{ visits: { visitedOn: string }[]; nextCursor: string }>(
      send(a.officer, 'GET', url),
    );
    expect(first.visits).toHaveLength(50);
    expect(first.visits[0]?.visitedOn).toBe('2026-02-21');
    const second = await answer<{ visits: { visitedOn: string }[]; nextCursor: null }>(
      send(a.officer, 'GET', `${url}&cursor=${first.nextCursor}`),
    );
    expect(second.visits.map(({ visitedOn }) => visitedOn)).toEqual(['2026-01-02']);
    expect(second.nextCursor).toBeNull();
    expect((await send(a.officer, 'GET', `${url}&cursor=bm9wZQ`)).statusCode).toBe(400);

    const theirs = await answer<{ visits: unknown[] }>(send(b.officer, 'GET', url));
    expect(theirs.visits).toEqual([]);
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
