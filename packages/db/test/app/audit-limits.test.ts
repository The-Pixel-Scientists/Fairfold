// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0016: the audit event size cap, the acting member's kind
// recorded when the event is written, and the second pass fixes for expired
// invitations (P1-03), hidden characters in tenant names (P1-11) and
// criteria that submitted reviews have scored (P3-03).

import { randomBytes, randomUUID } from 'node:crypto';

import { roles } from '@pixel-scientists/domain/platform';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notKept } from '../../classification/app.ts';
import { insertAuditEvent } from '../../src/audit.ts';
import { createDatabase } from '../../src/database.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { asMigratorRolledBack, databaseSettings, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addAssignment, scoreRow } from '../grants/assessment-fixtures.ts';
import { addStage, criterionRow } from '../grants/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

let tenant: TestTenant;
let staff: string;
let both: string;
let applicant: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  [staff, both, applicant] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant, ['programme_manager']),
    await addMember(client, tenant, ['reviewer', 'applicant']),
    await addMember(client, tenant, ['applicant']),
  ]);
}, 30_000);

function event(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    request_id: randomUUID(),
    actor_kind: 'system',
    action: 'platform.tenant.updated',
    entity_type: 'platform.tenant',
    entity_id: tenant.id,
    changes: {},
    ...change,
  };
}

describe('app.audit_event limits', { timeout: 30_000 }, () => {
  it('refuses changes over 65,536 bytes written directly as app_api', async () => {
    // jsonb prints {"a": "<value>"}: nine bytes around the value.
    const changes = (length: number) => JSON.stringify({ a: 'x'.repeat(length) });
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const [length, expected] of [
        [65_527, 'ok'],
        [65_528, '23514'],
      ] as const) {
        const { text, values } = insertStatement(
          client,
          'app.audit_event',
          event({ changes: changes(length) }),
        );
        expect(await outcome(client, text, values), String(length)).toBe(expected);
      }
    });
  });

  describe('the acting member', () => {
    let db: Kysely<unknown>;
    beforeAll(() => {
      db = createDatabase(databaseSettings('app_api', 1));
    });
    afterAll(() => db.destroy());

    /** Write an event as `actorId`, or the system, and return its entity id. */
    async function write(actorId: string | null): Promise<string> {
      const entityId = randomUUID();
      await withTenant(db, trustedTenantId(tenant.id), (trx) =>
        insertAuditEvent(trx, {
          requestId: randomUUID(),
          actorKind: actorId === null ? 'system' : 'user',
          actorId,
          action: 'platform.tenant.updated',
          entityType: 'platform.tenant',
          entityId,
          changes: {},
        }),
      );
      return entityId;
    }

    it('is recorded as staff or applicant when the event is written, and stays so', async () => {
      const entities: string[] = [];
      for (const actor of [staff, both, applicant, null]) entities.push(await write(actor));
      await asMigratorIn(tenant.id, (client) =>
        client.query("UPDATE app.membership SET roles = '{reviewer}' WHERE id = $1", [both]),
      );

      const { rows } = await asMigratorIn(tenant.id, (client) =>
        client.query(
          `SELECT actor_id, actor_member_kind FROM app.audit_event
            WHERE entity_id = ANY ($1::uuid[]) ORDER BY array_position($1::uuid[], entity_id)`,
          [entities],
        ),
      );
      expect(rows).toEqual([
        { actor_id: staff, actor_member_kind: 'staff' },
        { actor_id: both, actor_member_kind: 'applicant' },
        { actor_id: applicant, actor_member_kind: 'applicant' },
        { actor_id: null, actor_member_kind: null },
      ]);
    });

    it('never comes from the caller', async () => {
      await asRoleIn('app_api', tenant.id, async (client) => {
        const { text, values } = insertStatement(
          client,
          'app.audit_event',
          event({ actor_member_kind: 'staff' }),
        );
        expect(await outcome(client, text, values)).toBe('42501');
      });
    });

    it('is checked by the database, behind the trigger that sets it', async () => {
      const outcomes = await asMigratorRolledBack(async (client) => {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        await client.query(
          'ALTER TABLE app.audit_event DISABLE TRIGGER set_audit_actor_member_kind',
        );
        const results: string[] = [];
        for (const change of [
          { actor_member_kind: 'staff' },
          { actor_kind: 'user', actor_id: staff, actor_member_kind: 'admin' },
          { actor_kind: 'user', actor_id: staff, actor_member_kind: 'staff' },
        ]) {
          const { text, values } = insertStatement(client, 'app.audit_event', event(change));
          results.push(await outcome(client, text, values));
        }
        return results;
      });
      expect(outcomes).toEqual(['23514', '23514', 'ok']);
    });

    it("follows the trigger's rule: applicant is the one portal role", () => {
      const portal = Object.entries(roles).filter(([, role]) => role.app === 'portal');
      expect(portal.map(([name]) => name)).toEqual(['applicant']);
    });
  });

  it('has both checks validated', async () => {
    const { rows } = await asMigratorRolledBack((client) =>
      client.query(
        `SELECT conname, convalidated FROM pg_catalog.pg_constraint
          WHERE conrelid = 'app.audit_event'::regclass
            AND conname IN ('audit_event_changes_size', 'audit_event_actor_member_kind')
          ORDER BY 1`,
      ),
    );
    expect(rows).toEqual([
      { conname: 'audit_event_actor_member_kind', convalidated: true },
      { conname: 'audit_event_changes_size', convalidated: true },
    ]);
  });

  it('marks every json, jsonb and bytea column of the app schema as not kept', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ field: string }>(
        `SELECT table_schema || '.' || table_name || '.' || column_name AS field
           FROM information_schema.columns
          WHERE table_schema = 'app' AND data_type IN ('json', 'jsonb', 'bytea')`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { field } of rows) expect(notKept.has(field), field).toBe(true);
  });
});

describe('app.invitation, once expired (P1-03)', { timeout: 30_000 }, () => {
  it('cannot be accepted, but can still be revoked', async () => {
    const created = new Date(Date.now() - 8 * 86_400_000);
    const add = (at: Date | null) =>
      asMigratorIn(tenant.id, (client) =>
        insertRow(client, 'app.invitation', {
          tenant_id: tenant.id,
          email: `${randomUUID()}@example.test`,
          roles: ['reviewer'],
          token_hash: randomBytes(32),
          ...(at && { created_at: at, expires_at: new Date(at.getTime() + 168 * 3_600_000) }),
        }),
      );
    const expired = await add(created);
    const current = await add(null);
    const accept = `UPDATE app.invitation SET status = 'accepted', accepted_membership_id = $2,
                      updated_by = $2 WHERE id = $1`;
    const revoke = "UPDATE app.invitation SET status = 'revoked', updated_by = $2 WHERE id = $1";
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, accept, [expired, staff])).toBe('55000');
      expect(await outcome(client, revoke, [expired, staff])).toBe('ok');
      expect(await outcome(client, accept, [current, staff])).toBe('ok');
    });
  });
});

describe('app.tenant name (P1-11)', { timeout: 30_000 }, () => {
  it.each(['00ad', '034f', '115f', '1160', '180e', '3164', 'fff9', 'fffb', '0600', 'e0041'])(
    'refuses U+%s',
    async (code) => {
      const name = `North${String.fromCodePoint(Number.parseInt(code, 16))}field`;
      await asRoleIn('app_api', tenant.id, async (client) => {
        expect(await outcome(client, 'UPDATE app.tenant SET name = $1', [name])).toBe('23514');
      });
    },
  );
});

describe('grants.rubric_criterion, once scored (P3-03)', { timeout: 60_000 }, () => {
  it("keeps each tenant's criteria from every other tenant", async () => {
    await expectCrossTenantDenial('grants.rubric_criterion', async (client, owner) =>
      criterionRow(owner, await addStage(client, owner)),
    );
  });

  it('refuses a new weight or scale once a submitted review has scored it', async () => {
    const review = await asMigratorIn(tenant.id, async (client) => {
      const { id, review: added } = await addAssignment(client, tenant);
      await insertRow(client, 'grants.score', scoreRow(tenant, added, id));
      await client.query("UPDATE grants.assignment SET status = 'submitted' WHERE id = $1", [id]);
      return added;
    });
    const [scored, unscored] = review.criteria;
    const change = (set: string) =>
      `UPDATE grants.rubric_criterion SET ${set}, updated_by = $2 WHERE id = $1`;
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const set of ['weight = weight + 1', 'scale_min = 0', 'scale_max = 10']) {
        expect(await outcome(client, change(set), [scored, staff]), set).toBe('55000');
        expect(await outcome(client, change(set), [unscored, staff]), set).toBe('ok');
      }
      for (const set of ["label = 'Need, revised'", 'weight = weight']) {
        expect(await outcome(client, change(set), [scored, staff]), set).toBe('ok');
      }
    });
  });
});
