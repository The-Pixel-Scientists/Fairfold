// SPDX-License-Identifier: AGPL-3.0-or-later
//
// createJobRequest() against the test database as app_api: the request and
// its audit event commit together or not at all, and the event records the
// requester, kind and permission but no filter or field.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant, type Kysely } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trustedTenantId } from '../../../../packages/db/src/tenant-context.ts';
import { connectionSettings } from '../../../../packages/db/test/connect.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';

import { createJobRequest, type JobRequestActor, type JobRequestInput } from './job-request.ts';

let tenant: TestTenant;
let actor: JobRequestActor;
let api: Kysely<unknown>;
beforeAll(async () => {
  tenant = await createTestTenant();
  const member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  actor = { kind: 'user', membershipId: member, requestId: randomUUID() };
  const settings = connectionSettings('app_api');
  api = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password,
    maxConnections: 2,
    applicationName: 'tps-db-tests',
  });
}, 30_000);
afterAll(() => api.destroy());

const partyId = randomUUID();
const request: JobRequestInput = {
  kind: 'subject_access',
  permission: 'platform.subject_access.request',
  filters: { partyId },
  fieldIds: ['party.person.given_name', 'party.person.email'],
};

const rowsFor = (id: string) =>
  asMigratorIn(tenant.id, async (client) => {
    const requests = await client.query(
      `SELECT tenant_id, requested_by, permission, filters, field_ids, output_sensitivity,
              request_id, status
         FROM app.job_request WHERE id = $1`,
      [id],
    );
    const events = await client.query(
      `SELECT tenant_id, actor_kind, actor_id, action, entity_type, request_id, changes
         FROM app.audit_event WHERE entity_id = $1`,
      [id],
    );
    return { requests: requests.rows, events: events.rows };
  });

describe('createJobRequest', { timeout: 30_000 }, () => {
  it('writes the request and its audit event in the same transaction', async () => {
    const id = await withTenant(api, trustedTenantId(tenant.id), (trx) =>
      createJobRequest(trx, actor, request, 'platform.subject_access.requested'),
    );
    const { requests, events } = await rowsFor(id);
    expect(requests).toEqual([
      {
        tenant_id: tenant.id,
        requested_by: actor.membershipId,
        permission: 'platform.subject_access.request',
        filters: { partyId },
        field_ids: request.fieldIds,
        output_sensitivity: 'personal',
        request_id: actor.requestId,
        status: 'queued',
      },
    ]);
    expect(events).toEqual([
      {
        tenant_id: tenant.id,
        actor_kind: 'user',
        actor_id: actor.membershipId,
        action: 'platform.subject_access.requested',
        entity_type: 'platform.subject_access',
        request_id: actor.requestId,
        changes: {
          'app.job_request.kind': { after: 'subject_access' },
          'app.job_request.permission': { after: 'platform.subject_access.request' },
          'app.job_request.output_sensitivity': { after: 'personal' },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(partyId);
  });

  it('leaves neither behind when the transaction rolls back', async () => {
    let id = '';
    await expect(
      withTenant(api, trustedTenantId(tenant.id), async (trx) => {
        id = await createJobRequest(trx, actor, request, 'platform.audit_log.exported');
        throw new Error('The route failed after writing.');
      }),
    ).rejects.toThrow('The route failed after writing.');
    expect(id).not.toBe('');
    expect(await rowsFor(id)).toEqual({ requests: [], events: [] });
  });

  it('writes neither when the audit action is not a known one', async () => {
    await expect(
      withTenant(api, trustedTenantId(tenant.id), (trx) =>
        createJobRequest(trx, actor, request, 'platform.nothing.done'),
      ),
    ).rejects.toThrow("not in any module's list");
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT FROM app.job_request WHERE request_id = $1', [actor.requestId]),
    );
    expect(rows).toHaveLength(1);
  });
});
