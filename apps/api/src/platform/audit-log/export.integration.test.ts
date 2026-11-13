// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for an audit log export, and reading its status, through the whole
// API against the test database, as app_api: the permission and step-up, the
// request row and its audit event, the job sent, retries, and who may read
// the request.

import { randomUUID } from 'node:crypto';

import type { JobSender } from '@pixel-scientists/db/jobs';
import { exportAuditEvents, readAuditExport } from '@pixel-scientists/domain/platform/audit-log';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../../../../../packages/db/test/connect.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs, smtpTestSettings, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';
import { route } from '../../routes/register.ts';
import { AUDIT_EXPORT_FIELD_IDS } from './rows.ts';
import {
  readAuditExportHandler,
  replayAuditExportRequest,
  requestAuditExportHandler,
} from './export.ts';

interface Member {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
}

let api: FastifyInstance;
let database: ApiDatabase;
let jobs: JobSender;
const auth = testAuth();
const logs = captureLogs();

let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let otherAdminA: Member;
let managerA: Member;
let adminB: Member;
let person: string;

async function addMember(tenant: TestTenant, role: string): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
  );
  return { userId, membershipId, tenant };
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41004',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'info', destination: logs.stream });
  database = openDatabase(settings, logger);
  jobs = await database.startJobs(() => undefined);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'tenant_admin');
  otherAdminA = await addMember(tenantA, 'tenant_admin');
  managerA = await addMember(tenantA, 'programme_manager');
  adminB = await addMember(tenantB, 'tenant_admin');
  person = await asMigratorIn(tenantA.id, (client) => addPerson(client, tenantA));

  const composed = composeModules({ publicTenants: database.publicTenants, jobs });
  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composed,
    routes: [
      ...composed.routes,
      route(exportAuditEvents, requestAuditExportHandler(jobs), {
        replay: replayAuditExportRequest,
      }),
      route(readAuditExport, readAuditExportHandler),
    ],
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

const headers = (member: Member, recentAuthAt: Date | null = new Date()) =>
  auth.as({
    app: 'console',
    session: testSession({
      app: 'console',
      userId: member.userId,
      tenant: member.tenant.id,
      recentAuthAt,
    }),
  });

const ask = (
  member: Member,
  body: unknown,
  options: { key?: string; recentAuthAt?: Date | null } = {},
) =>
  api.inject({
    method: 'POST',
    url: '/api/console/audit-events/exports',
    headers: {
      ...headers(member, options.recentAuthAt),
      'idempotency-key': options.key ?? randomUUID(),
    },
    payload: body as Record<string, unknown>,
  });

const status = (member: Member, requestId: string) =>
  api.inject({
    method: 'GET',
    url: `/api/console/audit-events/exports/${requestId}`,
    headers: headers(member),
  });

const rowsOf = <T extends object>(tenant: TestTenant, text: string, values: unknown[] = []) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(text, values)).rows);

const requests = (tenant: TestTenant) =>
  rowsOf<{
    id: string;
    kind: string;
    requested_by: string;
    permission: string;
    filters: Record<string, string>;
    field_ids: string[];
    output_sensitivity: string;
    status: string;
  }>(
    tenant,
    `SELECT id, kind, requested_by, permission, filters, field_ids, output_sensitivity, status
       FROM app.job_request WHERE kind = 'audit_log_export' ORDER BY requested_at`,
  );

const requested = async (member: Member, body: unknown = {}): Promise<string> => {
  const response = await ask(member, body);
  expect(response.statusCode, response.body).toBe(202);
  return response.json<{ requestId: string }>().requestId;
};

describe('asking for an export', () => {
  it('lets only a holder of the export permission in, after a recent sign-in', async () => {
    const before = (await requests(tenantA)).length;

    expect((await ask(managerA, {})).statusCode).toBe(403);
    expect((await ask(adminA, {}, { recentAuthAt: null })).statusCode).toBe(403);
    expect(
      (await ask(adminA, {}, { recentAuthAt: new Date(Date.now() - 6 * 60_000) })).statusCode,
    ).toBe(403);
    const signedOut = await api.inject({
      method: 'POST',
      url: '/api/console/audit-events/exports',
      headers: { 'idempotency-key': randomUUID() },
      payload: {},
    });
    expect(signedOut.statusCode).toBe(401);

    expect(await requests(tenantA)).toHaveLength(before);
  });

  it('writes the request, its audit event and one job holding ids only', async () => {
    const requestId = await requested(adminA, { subjectPartyId: person, module: 'grants' });

    const row = (await requests(tenantA)).find((request) => request.id === requestId);
    expect(row).toEqual({
      id: requestId,
      kind: 'audit_log_export',
      requested_by: adminA.membershipId,
      permission: 'platform.audit.export',
      filters: { subjectPartyId: person, module: 'grants' },
      field_ids: [...AUDIT_EXPORT_FIELD_IDS],
      output_sensitivity: 'personal',
      status: 'queued',
    });

    const events = await rowsOf<{
      actor_id: string;
      changes: object;
      subject_party_id: string | null;
    }>(
      tenantA,
      `SELECT actor_id, changes, subject_party_id FROM app.audit_event
        WHERE action = 'platform.audit_log.exported' AND entity_id = $1`,
      [requestId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe(adminA.membershipId);
    expect(JSON.stringify(events[0]?.changes)).not.toContain(person);

    const sent = await withClient('migrator', (client) =>
      client.query<{ data: Record<string, string> }>(
        `SELECT data FROM pgboss.job WHERE name = 'platform.audit_log_export' AND data ->> 'jobRequest' = $1`,
        [requestId],
      ),
    );
    expect(sent.rows).toHaveLength(1);
    expect(Object.keys(sent.rows[0]?.data ?? {}).sort()).toEqual([
      'causingUserId',
      'jobRequest',
      'requestId',
      'tenantId',
    ]);
  });

  it('refuses a key the contract lacks and a bad value, and writes nothing', async () => {
    const before = (await requests(tenantA)).length;

    for (const body of [
      { tenantId: tenantB.id },
      { requestedBy: adminA.membershipId },
      { cursor: 'abc' },
      { subjectPartyId: 'nope' },
      { from: '2026-02-31' },
    ]) {
      const response = await ask(adminA, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.body).not.toMatch(/node_modules|\.ts:|select /i);
    }

    expect(await requests(tenantA)).toHaveLength(before);
  });

  it('answers a retry with the same key with the same request, once', async () => {
    const key = randomUUID();
    const body = { action: 'platform.theme.changed' };
    const before = (await requests(tenantA)).length;

    const first = await ask(adminA, body, { key });
    const second = await ask(adminA, body, { key });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await requests(tenantA)).toHaveLength(before + 1);
  });

  it('keeps the filters out of the logs', async () => {
    await requested(adminA, { subjectPartyId: person });

    expect(logs.text()).not.toContain(person);
  });
});

describe('reading the status', () => {
  it('shows the request to the member who asked, and no one else', async () => {
    const requestId = await requested(adminA);

    const own = await status(adminA, requestId);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: requestId, status: 'queued' });

    for (const [member, label] of [
      [otherAdminA, 'another member with the same permission'],
      [adminB, 'another tenant'],
    ] as const) {
      const response = await status(member, requestId);
      expect(response.statusCode, label).toBe(404);
      expect(response.body, label).not.toContain(requestId);
    }
    expect((await status(adminA, randomUUID())).statusCode).toBe(404);
  });

  it('does not show an export of another kind', async () => {
    const other = await asMigratorIn(tenantA.id, (client) =>
      insertRow(client, 'app.job_request', {
        tenant_id: tenantA.id,
        kind: 'view_csv_export',
        requested_by: adminA.membershipId,
        permission: 'grants.data.export',
        filters: JSON.stringify({}),
        field_ids: ['app.audit_event.action'],
        output_sensitivity: 'audit',
        request_id: randomUUID(),
      }),
    );

    expect((await status(adminA, other)).statusCode).toBe(404);
  });

  it('shows a failure as its code alone', async () => {
    const requestId = await requested(adminA);
    await rowsOf(tenantA, `UPDATE app.job_request SET status = 'running' WHERE id = $1`, [
      requestId,
    ]);
    await rowsOf(
      tenantA,
      `UPDATE app.job_request SET status = 'failed', failure_code = 'precondition_failed' WHERE id = $1`,
      [requestId],
    );

    const response = await status(adminA, requestId);

    expect(response.json()).toMatchObject({
      id: requestId,
      status: 'failed',
      failureCode: 'precondition_failed',
    });
  });
});
