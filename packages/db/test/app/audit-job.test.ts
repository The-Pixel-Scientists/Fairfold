// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0037: the job that wrote an audit event and the membership that
// caused it (ADR 0009). Only app_worker names them, only on a system event,
// the membership stays in the event's tenant, and the event stays
// append-only and invisible to every other tenant.

import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { insertAuditEvent } from '../../src/audit.ts';
import { createDatabase } from '../../src/database.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { APP_ROLES, asMigratorRolledBack, databaseSettings, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

let tenantA: TestTenant;
let tenantB: TestTenant;
let memberA: string;
let memberB: string;
beforeAll(async () => {
  tenantA = await createTestTenant();
  tenantB = await createTestTenant();
  memberA = await asMigratorIn(tenantA.id, (client) => addMember(client, tenantA));
  memberB = await asMigratorIn(tenantB.id, (client) => addMember(client, tenantB));
}, 30_000);

function jobEvent(tenant: TestTenant, origin: string | null, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    request_id: randomUUID(),
    actor_kind: 'system',
    action: 'platform.tenant.updated',
    entity_type: 'platform.tenant',
    entity_id: tenant.id,
    changes: {},
    job_id: randomUUID(),
    origin_membership_id: origin,
    ...change,
  };
}

describe('app.audit_event job_id and origin_membership_id', { timeout: 60_000 }, () => {
  it("keeps each tenant's job events from every other tenant", async () => {
    await expectCrossTenantDenial('app.audit_event', async (client, owner) =>
      jobEvent(owner, await addMember(client, owner)),
    );
  });

  it('are written by insertAuditEvent as app_worker, with a request id of their own', async () => {
    const db: Kysely<unknown> = createDatabase(databaseSettings('app_worker', 1));
    const jobId = randomUUID();
    const requestId = randomUUID();
    try {
      await withTenant(db, trustedTenantId(tenantA.id), (trx) =>
        insertAuditEvent(trx, {
          requestId,
          actorKind: 'system',
          actorId: null,
          action: 'platform.tenant.updated',
          entityType: 'platform.tenant',
          entityId: tenantA.id,
          changes: {},
          job: { jobId, originMembershipId: memberA },
        }),
      );
    } finally {
      await db.destroy();
    }
    const { rows } = await asMigratorIn(tenantA.id, (client) =>
      client.query(
        `SELECT request_id, actor_kind, actor_id, actor_member_kind, job_id, origin_membership_id
           FROM app.audit_event WHERE job_id = $1`,
        [jobId],
      ),
    );
    expect(rows).toEqual([
      {
        request_id: requestId,
        actor_kind: 'system',
        actor_id: null,
        actor_member_kind: null,
        job_id: jobId,
        origin_membership_id: memberA,
      },
    ]);
  });

  it('may have no origin, as a scheduled job has none', async () => {
    await asRoleIn('app_worker', tenantA.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.audit_event', jobEvent(tenantA, null));
      expect(await outcome(client, text, values)).toBe('ok');
    });
  });

  it("refuses another tenant's membership, or one that does not exist", async () => {
    await asRoleIn('app_worker', tenantA.id, async (client) => {
      for (const origin of [memberB, randomUUID()]) {
        const row = jobEvent(tenantA, origin);
        const { text, values } = insertStatement(client, 'app.audit_event', row);
        expect(await outcome(client, text, values)).toBe('23503');
      }
    });
  });

  // As migrator, since app_worker may not read the membership a user event's
  // trigger looks up.
  it('refuses a job on a user or operator event, and an origin without a job', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantA.id]);
      for (const change of [
        { actor_kind: 'user', actor_id: memberA },
        { actor_kind: 'operator' },
        { job_id: null },
      ]) {
        const row = jobEvent(tenantA, memberA, change);
        const { text, values } = insertStatement(client, 'app.audit_event', row);
        expect(await outcome(client, text, values), JSON.stringify(change)).toBe('23514');
      }
    });
  });

  it('cannot be written by app_api, nor updated or deleted by app_worker', async () => {
    await asRoleIn('app_api', tenantA.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.audit_event', jobEvent(tenantA, null));
      expect(await outcome(client, text, values)).toBe('42501');
    });
    await asRoleIn('app_worker', tenantA.id, async (client) => {
      const row = jobEvent(tenantA, memberA);
      const { text, values } = insertStatement(client, 'app.audit_event', row);
      await client.query(text, values);
      for (const change of ['job_id = NULL', 'origin_membership_id = NULL']) {
        expect(await outcome(client, `UPDATE app.audit_event SET ${change}`), change).toBe('42501');
      }
      expect(
        await outcome(client, 'DELETE FROM app.audit_event WHERE job_id = $1', [row.job_id]),
      ).toBe('42501');
    });
  });

  it('are insertable by app_worker alone', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ role: string; name: string }>(
        `SELECT r.role, c.name FROM pg_catalog.unnest($1::text[]) AS r(role)
           CROSS JOIN pg_catalog.unnest(ARRAY['job_id', 'origin_membership_id']) AS c(name)
          WHERE pg_catalog.has_column_privilege(r.role, 'app.audit_event', c.name, 'INSERT')
          ORDER BY 1, 2`,
        [APP_ROLES],
      ),
    );
    expect(rows).toEqual([
      { role: 'app_worker', name: 'job_id' },
      { role: 'app_worker', name: 'origin_membership_id' },
    ]);
  });
});
