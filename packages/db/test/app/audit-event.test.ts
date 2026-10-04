// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.audit_event (migration 0003): isolation, append-only for app_api,
// times the database sets, the checks on each column, auth copies written
// once, and insertAuditEvent() keeping only public and internal values.

import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertAuditEvent } from '../../src/audit.ts';
import { createDatabase } from '../../src/database.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { asMigratorRolledBack, databaseSettings } from '../connect.ts';
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

/** A tenant with a member, and a member of another tenant. */
let tenant: TestTenant;
let member: string;
let stranger: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function event(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    request_id: randomUUID(),
    actor_kind: 'user',
    actor_id: member,
    action: 'platform.membership.roles_changed',
    entity_type: 'platform.membership',
    entity_id: member,
    changes: {},
    ...change,
  };
}

describe('app.audit_event', { timeout: 30_000 }, () => {
  it("keeps each tenant's audit events from every other tenant", async () => {
    await expectCrossTenantDenial('app.audit_event', (_, owner) => ({
      tenant_id: owner.id,
      request_id: randomUUID(),
      actor_kind: 'system',
      action: 'platform.tenant.updated',
      entity_type: 'platform.tenant',
      entity_id: owner.id,
      changes: {},
    }));
  });

  it('lets app_api add and read events, but never change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const added = event();
      const { text, values } = insertStatement(client, 'app.audit_event', added);
      await client.query(text, values);
      const { rows } = await client.query(
        'SELECT action FROM app.audit_event WHERE request_id = $1',
        [added.request_id],
      );
      expect(rows).toEqual([{ action: 'platform.membership.roles_changed' }]);

      for (const change of ['changes = changes', 'retain_until = now()', 'occurred_at = now()']) {
        expect(await outcome(client, `UPDATE app.audit_event SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.audit_event')).toBe('42501');
      expect(await outcome(client, 'TRUNCATE app.audit_event')).toBe('42501');
      for (const column of ['id', 'occurred_at', 'retain_until']) {
        const supplied = insertStatement(client, 'app.audit_event', {
          ...event(),
          [column]: column === 'id' ? randomUUID() : new Date(0),
        });
        expect(await outcome(client, supplied.text, supplied.values), column).toBe('42501');
      }
    });
  });

  it('ignores a supplied occurred_at and retain_until, even from the owner', async () => {
    const { rows } = await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      const { text, values } = insertStatement(client, 'app.audit_event', {
        ...event(),
        occurred_at: new Date(0),
        retain_until: new Date(0),
      });
      return client.query(
        `${text} RETURNING occurred_at = now() AS now,
           retain_until = ((occurred_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'
             AS twelve_months`,
        values,
      );
    });
    expect(rows).toEqual([{ now: true, twelve_months: true }]);
  });

  it.each([
    ['accepts a system actor without a membership', { actor_kind: 'system', actor_id: null }, 'ok'],
    ['refuses a user actor without a membership', { actor_id: null }, '23514'],
    ['refuses an operator actor with a membership', { actor_kind: 'operator' }, '23514'],
    ['refuses an unknown actor kind', { actor_kind: 'admin' }, '23514'],
    ['refuses an action without an event', { action: 'platform.membership' }, '23514'],
    ['refuses an action in capitals', { action: 'Platform.membership.roles_changed' }, '23514'],
    [
      "refuses an entity type that is not the action's",
      { entity_type: 'platform.tenant' },
      '23514',
    ],
    ['refuses changes that are not an object', { changes: JSON.stringify(['a.b.c']) }, '23514'],
    ['refuses an actor from another tenant', { actor_id: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const fixed = {
        ...change,
        ...(change.actor_id === 'stranger' ? { actor_id: stranger } : {}),
      };
      const { text, values } = insertStatement(client, 'app.audit_event', event(fixed));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('writes a copy of each auth event once, and other events about one entity many times', async () => {
    const authEvent = randomUUID();
    const copy = (action: string) =>
      event({ action, entity_type: 'platform.auth', entity_id: authEvent });
    await asRoleIn('app_api', tenant.id, async (client) => {
      const first = insertStatement(client, 'app.audit_event', copy('platform.auth.signed_out'));
      await client.query(first.text, first.values);
      expect(await outcome(client, first.text, first.values)).toBe('23505');
      const other = insertStatement(
        client,
        'app.audit_event',
        copy('platform.auth.sessions_revoked'),
      );
      expect(await outcome(client, other.text, other.values)).toBe('23505');

      const change = insertStatement(client, 'app.audit_event', event());
      await client.query(change.text, change.values);
      expect(await outcome(client, change.text, change.values)).toBe('ok');
    });
  });
});

describe('insertAuditEvent()', { timeout: 30_000 }, () => {
  let db: Kysely<unknown>;
  beforeAll(() => {
    db = createDatabase(databaseSettings('app_api', 1));
  });
  afterAll(() => db.destroy());

  it("writes to the transaction's tenant, keeping values of public and internal fields only", async () => {
    const entityId = randomUUID();
    await withTenant(db, trustedTenantId(tenant.id), (trx) =>
      insertAuditEvent(trx, {
        requestId: randomUUID(),
        actorKind: 'user',
        actorId: member,
        action: 'platform.membership.created',
        entityType: 'platform.membership',
        entityId,
        changes: {
          'app.membership.roles': { after: ['reviewer'] },
          'app.membership.user_id': { after: 'a-personal-value' },
          'app.tenant.name': { before: 'Old name', after: 'New name' },
          f_answer1: { after: 'an-answer' },
        },
      }),
    );

    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT tenant_id, changes FROM app.audit_event WHERE entity_id = $1', [
        entityId,
      ]),
    );
    expect(rows).toEqual([
      {
        tenant_id: tenant.id,
        changes: {
          'app.membership.roles': { after: ['reviewer'] },
          'app.membership.user_id': {},
          'app.tenant.name': { before: 'Old name', after: 'New name' },
          f_answer1: {},
        },
      },
    ]);
  });
});
