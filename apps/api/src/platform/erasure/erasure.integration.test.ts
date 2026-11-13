// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Erasure through the whole API against the test database (ADR 0027): the
// request and status routes as app_api for two tenants, and the job as
// app_worker in a tenant's transaction. Who may ask, the step-up window, the
// same 404 for every party that cannot be erased, one erasure for retries and
// repeats, the ledger and audit trail, a module that is switched off, a
// contribution that fails, and nothing crossing tenants.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import { grantsErasure } from '@pixel-scientists/grants/server';
import { partyErasure, partyErasureTarget } from '@pixel-scientists/party/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  addFile,
  addParts,
  applicationRow,
} from '../../../../../packages/db/test/grants/application-fixtures.ts';
import { addOrganisation } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  insertRow,
  outcome,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../../test/modules-on.ts';
import {
  rowsOf,
  startProgrammeApi,
  type Problem,
  type ProgrammeApi,
} from '../../../test/programme-api.ts';
import { addMember, type Member } from '../../../test/settings-api.ts';
import { composeModules, erasureContributions } from '../../modules.ts';
import { workerModuleJobs } from '../../worker/module-jobs.ts';
import { schedules } from '../../worker/schedules.ts';
import { sweepTenant } from '../files/index.ts';
import { erasureJob, type Contribution } from './index.ts';

vi.setConfig({ testTimeout: 30_000 });

const FORM = {
  sections: [
    {
      id: 's_about',
      title: 'About the applicant',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Project name', classification: 'public' },
        { id: 'f_story', type: 'long_text', label: 'Your story', classification: 'personal' },
        {
          id: 'f_health',
          type: 'long_text',
          label: 'Any access needs',
          classification: 'special_category',
          audiences: 'aggregate_only',
        },
      ],
    },
  ],
};
const ANSWERS = { f_name: 'Hall roof', f_story: 'Born in Leeds', f_health: 'Step-free access' };
const path = '/console/erasure-requests';

interface Applicant {
  readonly person: string;
  readonly application: string;
  readonly file: string;
}

interface Status {
  id: string;
  status: string;
  counts?: Record<string, number>;
  failureCode?: string;
}

let t: ProgrammeApi;
let adminB: Member;
let worker: ReturnType<typeof createDatabase<unknown>>;
let applicantB: Applicant;

/** A person with a pinned form, an application with personal, special category and public answers and a linked file, and an earlier audit event. */
async function addApplicant(tenant: TestTenant, userId?: string): Promise<Applicant> {
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    await client.query(
      `UPDATE party.person SET given_name = 'Ada', family_name = 'Lovelace', phone = '07700900123',
              user_id = $2 WHERE id = $1`,
      [parts.person, userId ?? null],
    );
    const form = await insertRow(client, 'grants.form_version', {
      tenant_id: tenant.id,
      round_id: parts.round,
      version: 2,
      status: 'published',
      definition: FORM,
      published_at: new Date(),
      published_by: parts.member,
    });
    const application = await insertRow(
      client,
      'grants.application',
      applicationRow(tenant, parts, { form_version_id: form, answers: JSON.stringify(ANSWERS) }),
    );
    const file = await addFile(client, tenant, parts.member);
    await insertRow(client, 'grants.application_file', {
      tenant_id: tenant.id,
      application_id: application,
      file_id: file,
      field_id: 'f_accounts',
      created_by: parts.member,
    });
    await insertRow(client, 'app.audit_event', {
      tenant_id: tenant.id,
      request_id: randomUUID(),
      actor_kind: 'user',
      actor_id: parts.member,
      action: 'party.person.updated',
      entity_type: 'party.person',
      entity_id: parts.person,
      subject_party_id: parts.person,
      changes: JSON.stringify({}),
    });
    return { person: parts.person, application, file };
  });
}

beforeAll(async () => {
  t = await startProgrammeApi('41110');
  adminB = await addMember(t.tenantB, 'console', 'tenant_admin');
  const settings = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-api-tests',
  });
  applicantB = await addApplicant(t.tenantB);
}, 60_000);

afterAll(async () => {
  await worker.destroy();
  await t.close();
});

const ask = (
  member: Member | undefined,
  partyId: string,
  change: object = {},
  at: Date | null = new Date(),
  key: string = randomUUID(),
) =>
  t.send(
    member,
    'POST',
    path,
    { partyId, reason: 'subject_request', confirm: true, ...change },
    member?.app,
    at,
    key,
  );

const requested = async (partyId: string, member: Member = t.adminA): Promise<string> => {
  const response = await ask(member, partyId);
  expect(response.statusCode, response.body).toBe(202);
  return response.json<{ requestId: string }>().requestId;
};

const statusOf = async (member: Member, requestId: string): Promise<Status> => {
  const response = await t.send(member, 'GET', `${path}/${requestId}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Status>();
};

/** The job, as the worker's wrapper runs it: in the tenant, as app_worker. */
const runJob = (
  tenant: TestTenant,
  requestId: string,
  contributions: readonly Contribution[] = erasureContributions,
) =>
  withTenant(worker, trustedTenantId(tenant.id), (trx) =>
    erasureJob({ contributions, target: partyErasureTarget }).handler(trx, {
      id: randomUUID(),
      data: { jobRequest: requestId },
      context: { sender: t.jobs, requestId: randomUUID(), causingUserId: t.adminA.membershipId },
    }),
  );

const requestsFor = (party: string) =>
  rowsOf(t.tenantA, "SELECT 1 FROM app.job_request WHERE filters ->> 'partyId' = $1", [party]);
const personRow = (tenant: TestTenant, id: string) =>
  rowsOf<{ given_name: string | null; email: string; user_id: string | null }>(
    tenant,
    'SELECT given_name, email, user_id FROM party.person WHERE id = $1',
    [id],
  ).then((rows) => rows[0]);
const answersOf = (tenant: TestTenant, id: string) =>
  rowsOf<{ answers: Record<string, string> }>(
    tenant,
    'SELECT answers FROM grants.application WHERE id = $1',
    [id],
  ).then((rows) => rows[0]?.answers);
const ledger = (tenant: TestTenant, id: string) =>
  rowsOf<{ kind: string }>(
    tenant,
    'SELECT kind FROM app.erasure_ledger WHERE subject_party_id = $1 ORDER BY kind',
    [id],
  ).then((rows) => rows.map((row) => row.kind));
const fileOf = (id: string) =>
  rowsOf<{ name: string; sha256: Buffer | null; storage_key: string | null; erased: boolean }>(
    t.tenantA,
    'SELECT name, sha256, storage_key, erased_at IS NOT NULL AS erased FROM app.file WHERE id = $1',
    [id],
  ).then((rows) => rows[0]);
const linksTo = (file: string) =>
  rowsOf(t.tenantA, 'SELECT 1 FROM grants.application_file WHERE file_id = $1', [file]);
const eventsOf = (tenant: TestTenant, action: string) =>
  rowsOf<{ entity_id: string; actor_id: string | null; subject_party_id: string | null }>(
    tenant,
    'SELECT entity_id, actor_id, subject_party_id FROM app.audit_event WHERE action = $1',
    [action],
  );

describe('who may ask', () => {
  it('refuses a member without the erasure permission, an applicant and a signed-out caller, and writes nothing', async () => {
    const { person } = await addApplicant(t.tenantA);
    for (const member of [t.managerA, t.reviewerA, t.applicantA]) {
      expect((await ask(member, person)).statusCode).toBe(403);
      expect((await t.send(member, 'GET', `${path}/${randomUUID()}`)).statusCode).toBe(403);
    }
    expect((await ask(undefined, person)).statusCode).toBe(401);
    expect(await requestsFor(person)).toEqual([]);
  });

  it('asks for a recent sign-in, and writes nothing without one', async () => {
    const { person, application } = await addApplicant(t.tenantA);
    expect((await ask(t.adminA, person, {}, null)).statusCode).toBe(403);
    const old = new Date(Date.now() - 6 * 60_000);
    expect((await ask(t.adminA, person, {}, old)).statusCode).toBe(403);
    expect(await requestsFor(person)).toEqual([]);
    expect(await answersOf(t.tenantA, application)).toEqual(ANSWERS);
  });

  it('re-validates the body: a missing or false confirmation, an unknown reason and extra keys are refused', async () => {
    const { person } = await addApplicant(t.tenantA);
    for (const change of [
      { confirm: false },
      { confirm: 'true' },
      { confirm: undefined },
      { reason: 'because' },
      { reason: undefined },
      { tenantId: t.tenantB.id },
      { requestedBy: t.adminA.membershipId },
    ]) {
      expect((await ask(t.adminA, person, change)).statusCode, JSON.stringify(change)).toBe(400);
    }
    expect((await ask(t.adminA, 'not-an-id')).statusCode).toBe(400);
    expect(await requestsFor(person)).toEqual([]);
  });
});

describe('a party that cannot be erased', () => {
  it('answers one 404 for an unknown id, another tenant’s person and an organisation, never echoing the id', async () => {
    const organisation = await asMigratorIn(t.tenantA.id, (client) =>
      addOrganisation(client, t.tenantA),
    );
    const ids = [randomUUID(), applicantB.person, organisation];
    const answers = await Promise.all(ids.map((id) => ask(t.adminA, id)));

    for (const [index, response] of answers.entries()) {
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(ids[index]);
    }
    expect(new Set(answers.map((response) => response.json<Problem>().detail)).size).toBe(1);
    expect(await rowsOf(t.tenantB, "SELECT 1 FROM app.job_request WHERE kind = 'erasure'")).toEqual(
      [],
    );
  });

  it('answers the same 404 for a person already erased', async () => {
    const { person } = await addApplicant(t.tenantA);
    await runJob(t.tenantA, await requested(person));

    const again = await ask(t.adminA, person);
    expect(again.statusCode).toBe(404);
    expect(again.body).not.toContain(person);
  });

  it('refuses a member of staff with a problem that says to remove the membership first', async () => {
    const { person } = await addApplicant(t.tenantA, t.managerA.userId);
    const response = await ask(t.adminA, person);

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().detail).toContain('Remove their membership first');
    expect(response.body).not.toContain(person);
    expect(await requestsFor(person)).toEqual([]);
  });
});

describe('asking', () => {
  it('records who asked and queues one job holding ids only, and a retry answers the same request', async () => {
    const { person } = await addApplicant(t.tenantA);
    const key = randomUUID();
    const first = await ask(t.adminA, person, {}, new Date(), key);
    const retry = await ask(t.adminA, person, {}, new Date(), key);

    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    const { requestId } = first.json<{ requestId: string }>();
    expect(retry.json()).toEqual({ requestId });
    expect(
      await rowsOf(
        t.tenantA,
        "SELECT kind, requested_by, permission, status, filters FROM app.job_request WHERE filters ->> 'partyId' = $1",
        [person],
      ),
    ).toEqual([
      {
        kind: 'erasure',
        requested_by: t.adminA.membershipId,
        permission: 'platform.erasure.request',
        status: 'queued',
        filters: { partyId: person, reason: 'subject_request' },
      },
    ]);
    const jobs = await withClient('migrator', (client) =>
      client.query<{ data: Record<string, string> }>(
        "SELECT data FROM pgboss.job WHERE name = 'platform.erasure' AND data ->> 'jobRequest' = $1",
        [requestId],
      ),
    );
    expect(jobs.rows).toHaveLength(1);
    expect(Object.keys(jobs.rows[0]?.data ?? {}).sort()).toEqual([
      'causingUserId',
      'jobRequest',
      'requestId',
      'tenantId',
    ]);
    expect(await eventsOf(t.tenantA, 'platform.erasure.requested')).toContainEqual(
      expect.objectContaining({ entity_id: requestId, actor_id: t.adminA.membershipId }),
    );
    expect(await statusOf(t.adminA, requestId)).toMatchObject({ id: requestId, status: 'queued' });
    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
  });
});

describe('the erasure', () => {
  it('anonymises the person and clears their personal and special category answers, keeping the rest', async () => {
    const { person, application, file } = await addApplicant(t.tenantA);
    const eventsAbout = () =>
      rowsOf(t.tenantA, 'SELECT * FROM app.audit_event WHERE subject_party_id = $1 ORDER BY id', [
        person,
      ]);
    const before = await eventsAbout();
    const requestId = await requested(person);
    await runJob(t.tenantA, requestId);

    expect(await personRow(t.tenantA, person)).toEqual({
      given_name: null,
      email: `${person}@erased.invalid`,
      user_id: null,
    });
    const [party] = await rowsOf<{ status: string; erased_at: Date | null }>(
      t.tenantA,
      'SELECT status, erased_at FROM party.party WHERE id = $1',
      [person],
    );
    expect(party?.status).toBe('erased');
    expect(party?.erased_at).not.toBeNull();
    expect(await answersOf(t.tenantA, application)).toEqual({ f_name: 'Hall roof' });
    expect(await fileOf(file)).toEqual({
      name: 'Erased file',
      sha256: null,
      storage_key: null,
      erased: true,
    });
    expect(await linksTo(file)).toHaveLength(1);
    expect(await ledger(t.tenantA, person)).toEqual(['party_erased', 'subject_key_destroyed']);

    const done = await statusOf(t.adminA, requestId);
    expect(done).toMatchObject({
      status: 'done',
      counts: { 'party.party': 1, 'party.person': 1, 'grants.application': 1, 'app.file': 1 },
    });
    expect(JSON.stringify(done)).not.toContain(person);
    expect(await eventsOf(t.tenantA, 'platform.erasure.completed')).toContainEqual(
      expect.objectContaining({ entity_id: requestId, subject_party_id: person }),
    );
    // Every earlier event about the person is as it was, and the app role still cannot change one.
    const after = await eventsAbout();
    for (const event of before) expect(after).toContainEqual(event);
    const refused = await asRoleIn('app_api', t.tenantA.id, async (client) => [
      await outcome(client, "UPDATE app.audit_event SET action = 'x' WHERE subject_party_id = $1", [
        person,
      ]),
      await outcome(client, 'DELETE FROM app.audit_event WHERE subject_party_id = $1', [person]),
    ]);
    expect(refused).toEqual(['42501', '42501']);
  });

  it('does not change an outcome: the application keeps its status, round and form version', async () => {
    const { person, application } = await addApplicant(t.tenantA);
    const read = () =>
      rowsOf(
        t.tenantA,
        'SELECT status, round_id, form_version_id FROM grants.application WHERE id = $1',
        [application],
      );
    const before = await read();
    await runJob(t.tenantA, await requested(person));

    expect(await read()).toEqual(before);
  });

  it('leaves no object for the sweep to keep: the erased file’s row points at nothing, so the sweep deletes it', async () => {
    const { person, file } = await addApplicant(t.tenantA);
    const key = `clean/${t.tenantA.id}/${file}`;
    await runJob(t.tenantA, await requested(person));

    const deleted: string[] = [];
    const removal = {
      versioned: () => Promise.resolve(false),
      list: async function* (prefix: string) {
        await Promise.resolve();
        if (key.startsWith(prefix)) yield key;
      },
      head: () => Promise.resolve(new Date(Date.now() - 2 * 3_600_000)),
      delete: (found: string) => {
        deleted.push(found);
        return Promise.resolve();
      },
    };
    await withTenant(worker, trustedTenantId(t.tenantA.id), (trx) =>
      sweepTenant(trx, { removal }, t.tenantA.id),
    );

    expect(deleted).toEqual([key]);
  });

  it('erases once for two requests with different keys: one party event and one row for each ledger kind', async () => {
    const { person } = await addApplicant(t.tenantA);
    const first = await requested(person);
    const second = await requested(person);
    expect(second).not.toBe(first);
    await runJob(t.tenantA, first);
    await runJob(t.tenantA, second);

    expect(await ledger(t.tenantA, person)).toEqual(['party_erased', 'subject_key_destroyed']);
    expect(
      await rowsOf(
        t.tenantA,
        "SELECT 1 FROM app.audit_event WHERE action = 'party.party.erased' AND entity_id = $1",
        [person],
      ),
    ).toHaveLength(1);
    expect(await statusOf(t.adminA, second)).toMatchObject({
      status: 'done',
      counts: { 'party.party': 0, 'grants.application': 0 },
    });
  });

  it('does nothing when the same delivery arrives twice', async () => {
    const { person } = await addApplicant(t.tenantA);
    const requestId = await requested(person);
    await runJob(t.tenantA, requestId);
    await runJob(t.tenantA, requestId);

    const completed = await eventsOf(t.tenantA, 'platform.erasure.completed');
    expect(completed.filter((event) => event.entity_id === requestId)).toHaveLength(1);
  });

  it('clears the answers while the grants module is switched off', async () => {
    const { person, application } = await addApplicant(t.tenantA);
    await switchModule(t.tenantA, 'grants', false);
    try {
      await runJob(t.tenantA, await requested(person));
    } finally {
      await switchModule(t.tenantA, 'grants', true);
    }

    expect(await answersOf(t.tenantA, application)).toEqual({ f_name: 'Hall roof' });
  });

  it('rolls everything back when a contribution fails, and marks the request failed with a code and an event', async () => {
    const { person, application, file } = await addApplicant(t.tenantA);
    const requestId = await requested(person);
    const failing: Contribution = {
      module: 'crm',
      erase: () => Promise.reject(new Error('The crm module failed for Ada Lovelace.')),
    };

    await runJob(t.tenantA, requestId, [...erasureContributions, failing]);

    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
    expect(await answersOf(t.tenantA, application)).toEqual(ANSWERS);
    expect(await fileOf(file)).toMatchObject({ name: 'Accounts 2025.pdf', erased: false });
    expect(await ledger(t.tenantA, person)).toEqual([]);
    expect(
      await rowsOf(t.tenantA, 'SELECT 1 FROM app.subject_key WHERE subject_party_id = $1', [
        person,
      ]),
    ).toEqual([]);
    expect(await eventsOf(t.tenantA, 'platform.erasure.completed')).not.toContainEqual(
      expect.objectContaining({ entity_id: requestId }),
    );
    const status = await statusOf(t.adminA, requestId);
    expect(status).toMatchObject({ status: 'failed', failureCode: 'internal' });
    expect(JSON.stringify(status)).not.toContain('Lovelace');
    const failed = await rowsOf(
      t.tenantA,
      "SELECT subject_party_id, changes FROM app.audit_event WHERE action = 'platform.erasure.failed' AND entity_id = $1",
      [requestId],
    );
    expect(failed).toEqual([
      {
        subject_party_id: person,
        changes: { 'app.job_request.failure_code': { after: 'internal' } },
      },
    ]);
  });

  it('fails a person whose account still holds a membership, without erasing, and says so by code', async () => {
    const member = await addMember(t.tenantA, 'portal', 'applicant');
    const { person, application } = await addApplicant(t.tenantA, member.userId);
    const requestId = await requested(person);
    await runJob(t.tenantA, requestId);

    expect(await statusOf(t.adminA, requestId)).toMatchObject({
      status: 'failed',
      failureCode: 'precondition_failed',
    });
    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
    expect(await answersOf(t.tenantA, application)).toEqual(ANSWERS);
    expect(await eventsOf(t.tenantA, 'platform.erasure.failed')).toContainEqual(
      expect.objectContaining({ entity_id: requestId, subject_party_id: person }),
    );
    expect(await ledger(t.tenantA, person)).toEqual([]);
  });

  it.each([
    ['removed', "status = 'removed'"],
    ['demoted to a role without the permission', "roles = ARRAY['reviewer']"],
  ])('fails a request whose requester was %s, without erasing', async (_, change) => {
    const requester = await addMember(t.tenantA, 'console', 'tenant_admin');
    const { person, application, file } = await addApplicant(t.tenantA);
    const requestId = await requested(person, requester);
    await rowsOf(t.tenantA, `UPDATE app.membership SET ${change} WHERE id = $1 RETURNING 1`, [
      requester.membershipId,
    ]);
    await runJob(t.tenantA, requestId);

    expect(await statusOf(t.adminA, requestId)).toMatchObject({
      status: 'failed',
      failureCode: 'precondition_failed',
    });
    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
    expect(await answersOf(t.tenantA, application)).toEqual(ANSWERS);
    expect(await fileOf(file)).toMatchObject({ erased: false });
    expect(await ledger(t.tenantA, person)).toEqual([]);
    expect(await eventsOf(t.tenantA, 'platform.erasure.failed')).toContainEqual(
      expect.objectContaining({ entity_id: requestId, subject_party_id: person }),
    );
    expect(await eventsOf(t.tenantA, 'platform.erasure.completed')).not.toContainEqual(
      expect.objectContaining({ entity_id: requestId }),
    );
  });
});

describe('across tenants', () => {
  it('lets no one read another tenant’s request, and a member without the permission reads none', async () => {
    const { person } = await addApplicant(t.tenantA);
    const requestId = await requested(person);

    expect((await t.send(adminB, 'GET', `${path}/${requestId}`)).statusCode).toBe(404);
    expect((await t.send(t.managerA, 'GET', `${path}/${requestId}`)).statusCode).toBe(403);
    expect((await t.send(t.adminA, 'GET', `${path}/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('lets another tenant’s administrator neither erase nor find a person', async () => {
    const { person } = await addApplicant(t.tenantA);
    const response = await ask(adminB, person);

    expect(response.statusCode).toBe(404);
    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
  });

  it('changes nothing in tenant B when the contributions run in B for A’s person', async () => {
    const { person } = await addApplicant(t.tenantA);
    const subjects = [
      { partyId: person, givenName: null, familyName: null, email: null, accountId: null },
    ];
    const inB = <T>(work: (trx: Parameters<typeof partyErasure.erase>[0]) => Promise<T>) =>
      withTenant(worker, trustedTenantId(t.tenantB.id), work);

    await expect(inB((trx) => partyErasure.erase(trx, subjects))).rejects.toThrow(
      'Erasure needs a running erasure request for the party.',
    );
    expect(await inB((trx) => grantsErasure.erase(trx, subjects))).toEqual({
      'grants.application': 0,
      'app.file': 0,
      'grants.reminder_email': 0,
    });
    expect(await personRow(t.tenantA, person)).toMatchObject({ given_name: 'Ada' });
    expect(await personRow(t.tenantB, applicantB.person)).toMatchObject({ given_name: 'Ada' });
    expect(await answersOf(t.tenantB, applicantB.application)).toEqual(ANSWERS);
  });
});

describe('nothing erases without a request', () => {
  it('has one route that asks, one that reads, and a job no schedule sends', () => {
    const { routes } = composeModules({
      publicTenants: {
        tenant: () => Promise.resolve(undefined),
        logo: () => Promise.resolve(undefined),
      },
    });
    const erasure = routes.filter(({ contract }) => contract.path.includes('erasure'));
    expect(erasure.map(({ contract }) => `${contract.method} ${contract.path}`)).toEqual([
      'POST /console/erasure-requests',
      'GET /console/erasure-requests/:requestId',
    ]);
    const jobs = workerModuleJobs({
      sender: { send: () => Promise.resolve({ sent: true }) },
      portalOrigin: 'https://portal.example.org',
    });
    expect(jobs.map(({ queue }) => queue.name).filter((name) => name.includes('erasure'))).toEqual([
      'platform.erasure',
    ]);
    expect(
      schedules.map(({ queue }) => queue.name).filter((name) => name.includes('erasure')),
    ).toEqual([]);
    expect(schedules.map(({ data }) => JSON.stringify(data)).join()).not.toContain('erasure');
  });
});
