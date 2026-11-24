// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy routes through the whole API against the test database, as
// app_api: sessions, the policy, the module switch, row-level security,
// replays and the audit log, for two tenants, with the server clock fixed.
// The handlers' own rules are tested with the module.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn, createTestTenant } from '../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../test/modules-on.ts';
import { rowsOf } from '../../test/programme-api.ts';
import { addMember, events, type Member } from '../../test/settings-api.ts';
import { expectLooksMissing, smtpTestSettings, testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { openDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';
import { privacyCompositionAt } from './privacy.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

/** A Wednesday: a request received on Tuesday 10 November is due on Thursday 10 December. */
const NOW = new Date('2026-11-18T12:00:00Z');

const { database: settings } = loadConfig({
  ...process.env,
  ...smtpTestSettings,
  TPS_API_PORT: '41132',
  TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
});
const logger = createLogger({ level: 'silent' });
const database = openDatabase(settings, logger);
const auth = testAuth();
const jobs = await database.startJobs(() => undefined);
const api = await buildApp({
  logger,
  checkDatabase: () => database.check(),
  inTenant: database.inTenant,
  auth: auth.module,
  ...composeModules({ publicTenants: database.publicTenants, jobs }, [
    privacyCompositionAt(() => NOW),
  ]),
});

type Tenant = Awaited<ReturnType<typeof createTestTenant>>;

let tenantA: Tenant;
let tenantB: Tenant;
let tenantOff: Tenant;
let adminA: Member;
let managerA: Member;
let adminB: Member;
let adminOff: Member;

beforeAll(async () => {
  [tenantA, tenantB, tenantOff] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
  adminOff = await addMember(tenantOff, 'console', 'tenant_admin');
  await switchModule(tenantA, 'privacy');
  await switchModule(tenantB, 'privacy');
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
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

const person = (tenant: Tenant) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, {}));
const audited = (tenant: Tenant, action: string, entityId: string) =>
  rowsOf<{ subject_party_id: string | null }>(
    tenant,
    'SELECT subject_party_id FROM app.audit_event WHERE action = $1 AND entity_id = $2',
    [action, entityId],
  );

const requestBody = (personId: string, change: Record<string, unknown> = {}) => ({
  personId,
  receivedAt: '2026-11-10T10:00:00.000Z',
  kind: 'access',
  channel: 'email',
  summary: 'Synthetic request for a copy of the data held',
  identityCheck: 'verified',
  ...change,
});

interface Created {
  id: string;
}

describe('who may reach the privacy routes', () => {
  it('refuses a member without the permission, for each group of routes', async () => {
    for (const [method, url, body] of [
      ['GET', '/console/rights-requests'],
      ['POST', '/console/rights-requests', requestBody(randomUUID())],
      ['GET', '/console/breaches'],
      ['GET', '/console/dpias'],
      ['GET', '/console/records-of-processing'],
      ['GET', '/console/processors'],
      ['POST', `/console/rights-requests/${randomUUID()}/erasure`, { confirm: true }],
    ] as const) {
      const refused = await send(managerA, method, url, body, { recent: true });
      expect(refused.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('answers 404 for a tenant with the tool off, and 401 with no session', async () => {
    expect((await send(adminOff, 'GET', '/console/rights-requests')).statusCode).toBe(404);
    expect((await send(adminOff, 'GET', '/console/breaches')).statusCode).toBe(404);
    const signedOut = await api.inject({ method: 'GET', url: '/api/console/dpias' });
    expect(signedOut.statusCode).toBe(401);
  });

  it('does not serve the routes whose pieces are not built yet', async () => {
    const id = randomUUID();
    for (const [method, url] of [
      ['POST', `/console/rights-requests/${id}/export`],
      ['GET', `/console/rights-requests/${id}/export`],
      ['GET', `/console/people/${id}/consent-history`],
    ] as const) {
      expect((await send(adminA, method, url, undefined, { recent: true })).statusCode).toBe(404);
    }
  });
});

describe('rights requests', () => {
  it('logs a request once for a repeated key, with the due date from the fixed clock, audited for the person', async () => {
    const subject = await person(tenantA);
    const key = randomUUID();

    const first = await answer<Created & { clock: unknown }>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject), { key }),
      201,
    );
    const again = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject), { key }),
      201,
    );

    expect(first.clock).toEqual({ state: 'running', dueOn: '2026-12-10' });
    expect(again.id).toBe(first.id);
    expect(await audited(tenantA, 'privacy.rights_request.created', first.id)).toEqual([
      { subject_party_id: subject },
    ]);
  });

  it('refuses a received time after the fixed clock, and an unknown key in the body', async () => {
    const subject = await person(tenantA);
    const future = await send(
      adminA,
      'POST',
      '/console/rights-requests',
      requestBody(subject, { receivedAt: '2026-11-19T10:00:00.000Z' }),
    );
    const extra = await send(
      adminA,
      'POST',
      '/console/rights-requests',
      requestBody(subject, { tenantId: tenantB.id }),
    );

    expect(future.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
  });

  it('pauses the clock once for a repeated key, and audits the read of a request', async () => {
    const subject = await person(tenantA);
    const { id } = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject)),
      201,
    );
    const key = randomUUID();
    const pause = { on: '2026-11-18', reason: 'clarification' };

    const paused = await answer<{ clock: unknown }>(
      send(adminA, 'POST', `/console/rights-requests/${id}/pause`, pause, { key }),
      200,
    );
    await answer(send(adminA, 'POST', `/console/rights-requests/${id}/pause`, pause, { key }));
    await answer(send(adminA, 'GET', `/console/rights-requests/${id}`));

    expect(paused.clock).toEqual({ state: 'paused', dueOn: null });
    expect(await audited(tenantA, 'privacy.rights_request.paused', id)).toHaveLength(1);
    expect(await audited(tenantA, 'privacy.rights_request.viewed', id)).toEqual([
      { subject_party_id: subject },
    ]);
  });

  it('keeps a request, its tasks and its list out of other tenants', async () => {
    const subject = await person(tenantA);
    const { id } = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject)),
      201,
    );
    const task = {
      title: 'Check grants records',
      assigneeMembershipId: null,
      moduleId: null,
      dueOn: null,
    };

    const made = await answer<Created>(
      send(adminA, 'POST', `/console/rights-requests/${id}/tasks`, task),
      201,
    );
    await answer(
      send(adminA, 'POST', `/console/rights-requests/${id}/tasks/${made.id}/completion`),
      200,
    );

    expectLooksMissing(
      await send(adminB, 'GET', `/console/rights-requests/${id}`),
      await send(adminB, 'GET', `/console/rights-requests/${randomUUID()}`),
    );
    expect((await send(adminB, 'GET', `/console/rights-requests/${id}/tasks`)).statusCode).toBe(
      404,
    );
    expect(
      (await send(adminB, 'POST', `/console/rights-requests/${id}/tasks`, task)).statusCode,
    ).toBe(404);
    const theirs = await answer<{ requests: Created[] }>(
      send(adminB, 'GET', '/console/rights-requests'),
    );
    expect(theirs.requests.map((r) => r.id)).not.toContain(id);
    expect(await audited(tenantA, 'privacy.request_task.completed', made.id)).toEqual([
      { subject_party_id: subject },
    ]);
  });
});

describe('erasure from a request', () => {
  const start = (member: Member, id: string, options?: Parameters<typeof send>[4]) =>
    send(member, 'POST', `/console/rights-requests/${id}/erasure`, { confirm: true }, options);

  it('asks for a recent sign-in, and starts the platform erasure once for a repeated key', async () => {
    const subject = await person(tenantA);
    const { id } = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject, { kind: 'erasure' })),
      201,
    );
    const key = randomUUID();

    expect((await start(adminA, id)).statusCode).toBe(403);
    const first = await answer<{ requestId: string }>(
      start(adminA, id, { key, recent: true }),
      202,
    );
    const again = await answer<{ requestId: string }>(
      start(adminA, id, { key, recent: true }),
      202,
    );

    expect(again.requestId).toBe(first.requestId);
    expect(
      await rowsOf(tenantA, "SELECT 1 FROM app.job_request WHERE filters ->> 'partyId' = $1", [
        subject,
      ]),
    ).toHaveLength(1);
    expect(await audited(tenantA, 'privacy.rights_request.erasure_started', id)).toEqual([
      { subject_party_id: subject },
    ]);
    const status = await answer<{ id: string; status: string }>(
      send(adminA, 'GET', `/console/rights-requests/${id}/erasure`),
    );
    expect(status).toMatchObject({ id: first.requestId, status: 'queued' });
    const shown = await answer<{ erasureRequestId: string }>(
      send(adminA, 'GET', `/console/rights-requests/${id}`),
    );
    expect(shown.erasureRequestId).toBe(first.requestId);
  });

  it('refuses an identity that is not checked, and a request that is not for erasure', async () => {
    const subject = await person(tenantA);
    const unchecked = await answer<Created>(
      send(
        adminA,
        'POST',
        '/console/rights-requests',
        requestBody(subject, { kind: 'erasure', identityCheck: 'requested' }),
      ),
      201,
    );
    const access = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject)),
      201,
    );

    expect((await start(adminA, unchecked.id, { recent: true })).statusCode).toBe(409);
    expect((await start(adminA, access.id, { recent: true })).statusCode).toBe(409);
    expect(
      await rowsOf(tenantA, "SELECT 1 FROM app.job_request WHERE filters ->> 'partyId' = $1", [
        subject,
      ]),
    ).toEqual([]);
  });

  it('answers another tenant’s request as it answers a missing one, and starts nothing', async () => {
    const subject = await person(tenantA);
    const { id } = await answer<Created>(
      send(adminA, 'POST', '/console/rights-requests', requestBody(subject, { kind: 'erasure' })),
      201,
    );

    expectLooksMissing(
      await start(adminB, id, { recent: true }),
      await start(adminB, randomUUID(), { recent: true }),
    );
    expect((await send(adminB, 'GET', `/console/rights-requests/${id}/erasure`)).statusCode).toBe(
      404,
    );
    expect(
      await rowsOf(tenantA, "SELECT 1 FROM app.job_request WHERE filters ->> 'partyId' = $1", [
        subject,
      ]),
    ).toEqual([]);
  });
});

describe('breaches', () => {
  const update = {
    discoveredAt: '2026-11-17T09:00:00.000Z',
    description: 'Synthetic email sent to the wrong list',
    dataCategories: ['contact'],
    approximateSubjects: 12,
    approximateRecords: null,
    likelyConsequences: 'Synthetic consequence',
    measuresTaken: 'Synthetic measure',
  };
  const breach = { becameAwareAt: '2026-11-17T12:00:00.000Z', ...update };

  it('records a breach once for a repeated key, with its 72-hour clock from the fixed clock', async () => {
    const key = randomUUID();

    const first = await answer<Created & { clock: unknown }>(
      send(adminA, 'POST', '/console/breaches', breach, { key }),
      201,
    );
    const again = await answer<Created>(
      send(adminA, 'POST', '/console/breaches', breach, { key }),
      201,
    );

    expect(again.id).toBe(first.id);
    expect(first.clock).toEqual({
      deadline: '2026-11-20T12:00:00.000Z',
      hoursRemaining: 48,
      late: false,
    });
    expect(
      (await events(tenantA, 'privacy.breach.recorded')).filter((e) => e.entity_id === first.id),
    ).toHaveLength(1);
  });

  it('keeps a breach out of other tenants', async () => {
    const { id } = await answer<Created>(send(adminA, 'POST', '/console/breaches', breach), 201);

    expectLooksMissing(
      await send(adminB, 'GET', `/console/breaches/${id}`),
      await send(adminB, 'GET', `/console/breaches/${randomUUID()}`),
    );
    expect((await send(adminB, 'PUT', `/console/breaches/${id}`, update)).statusCode).toBe(404);
    const theirs = await answer<{ breaches: Created[] }>(send(adminB, 'GET', '/console/breaches'));
    expect(theirs.breaches.map((b) => b.id)).not.toContain(id);
  });
});

describe('impact assessments and the register of processing', () => {
  it('records an impact assessment once for a repeated key, and keeps it out of other tenants', async () => {
    const dpia = {
      title: 'Synthetic assessment',
      processingActivityIds: [],
      screening: { q_scale: 'yes' },
      risks: [],
      dpoAdvice: 'Synthetic advice',
    };
    const key = randomUUID();

    const first = await answer<Created>(send(adminA, 'POST', '/console/dpias', dpia, { key }), 201);
    const again = await answer<Created>(send(adminA, 'POST', '/console/dpias', dpia, { key }), 201);

    expect(again.id).toBe(first.id);
    expect(
      (await events(tenantA, 'privacy.dpia.created')).filter((e) => e.entity_id === first.id),
    ).toHaveLength(1);
    expect((await send(adminB, 'GET', `/console/dpias/${first.id}`)).statusCode).toBe(404);
  });

  it('records an activity and a processor once for a repeated key, and keeps both out of other tenants', async () => {
    const activity = {
      name: 'Synthetic grant administration',
      purpose: 'Synthetic purpose of the processing',
      legalBasis: 'public_task',
      specialCategoryCondition: null,
      dataCategories: ['identity', 'contact'],
      subjectCategories: ['applicants'],
      recipients: 'Synthetic panel',
      processorIds: [],
      transfersAbroad: '',
      retention: 'Six years after the grant ends',
      securityMeasures: 'Synthetic measures',
    };
    const processor = {
      name: 'Synthetic hosting provider',
      service: 'Synthetic hosting',
      countryCode: 'GB',
      contractSignedOn: '2026-01-31',
      transferSafeguard: null,
    };
    const keys = [randomUUID(), randomUUID()] as const;

    const made = await answer<Created>(
      send(adminA, 'POST', '/console/processing-activities', activity, { key: keys[0] }),
      201,
    );
    const madeAgain = await answer<Created>(
      send(adminA, 'POST', '/console/processing-activities', activity, { key: keys[0] }),
      201,
    );
    const host = await answer<Created>(
      send(adminA, 'POST', '/console/processors', processor, { key: keys[1] }),
      201,
    );
    const hostAgain = await answer<Created>(
      send(adminA, 'POST', '/console/processors', processor, { key: keys[1] }),
      201,
    );

    expect(madeAgain.id).toBe(made.id);
    expect(hostAgain.id).toBe(host.id);
    expect(
      (await events(tenantA, 'privacy.processing_activity.changed')).filter(
        (e) => e.entity_id === made.id,
      ),
    ).toHaveLength(1);
    expect(
      (await send(adminB, 'GET', `/console/processing-activities/${made.id}`)).statusCode,
    ).toBe(404);
    const theirs = await answer<{ processors: Created[] }>(
      send(adminB, 'GET', '/console/processors'),
    );
    expect(theirs.processors.map((p) => p.id)).not.toContain(host.id);
  });
});
