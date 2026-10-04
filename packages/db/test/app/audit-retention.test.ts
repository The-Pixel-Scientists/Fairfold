// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.retention_policy and the audit retention rule (migration 0003):
// isolation, read-only for app_api, the 365-day minimum, retain_until from
// the tenant's rule, and the 12-month floor on every audit event.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack } from '../connect.ts';
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

/** A tenant with a member. */
let tenant: TestTenant;
let member: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}, 30_000);

function policy(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    policy: 'audit',
    days: 400,
    created_by: member,
    updated_by: member,
    ...change,
  };
}

/** Run `work` as migrator in `tenant.id`, and roll it back. */
function asMigratorInTenant<T>(work: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  return asMigratorRolledBack(async (client) => {
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    return work(client);
  });
}

/** Add an audit event, and say whether its retain_until is `interval` after occurred_at, in UTC. */
async function keptFor(client: pg.ClientBase, interval: string): Promise<boolean | undefined> {
  const { rows } = await client.query<{ exact: boolean }>(
    `INSERT INTO app.audit_event
       (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
     VALUES ($1, $2, 'system', 'platform.tenant.updated', 'platform.tenant', $1, '{}')
     RETURNING retain_until = ((occurred_at AT TIME ZONE 'UTC') + $3::interval) AT TIME ZONE 'UTC'
       AS exact`,
    [tenant.id, randomUUID(), interval],
  );
  return rows[0]?.exact;
}

describe('app.retention_policy', { timeout: 30_000 }, () => {
  it("keeps each tenant's retention settings from every other tenant", async () => {
    await expectCrossTenantDenial('app.retention_policy', async (client, owner) => {
      const by = await addMember(client, owner);
      return { tenant_id: owner.id, policy: 'audit', days: 365, created_by: by, updated_by: by };
    });
  });

  it('lets app_api read the settings, but never add, change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.retention_policy', policy());
      expect(await outcome(client, text, values)).toBe('42501');
      expect(await outcome(client, 'UPDATE app.retention_policy SET days = 400')).toBe('42501');
      expect(await outcome(client, 'DELETE FROM app.retention_policy')).toBe('42501');
      expect(await outcome(client, 'SELECT days FROM app.retention_policy')).toBe('ok');
    });
  });

  it.each([
    ['accepts an audit rule of 365 days', { days: 365 }, 'ok'],
    ['refuses an audit rule under 365 days', { days: 364 }, '23514'],
    ['refuses more than 100 years', { days: 36_501 }, '23514'],
    ['refuses an unknown policy', { policy: 'documents' }, '23514'],
  ])('%s', async (_, change: Row, expected) => {
    await asMigratorInTenant(async (client) => {
      const { text, values } = insertStatement(client, 'app.retention_policy', policy(change));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('holds one rule per policy in each tenant', async () => {
    await asMigratorInTenant(async (client) => {
      const { text, values } = insertStatement(client, 'app.retention_policy', policy());
      await client.query(text, values);
      expect(await outcome(client, text, values)).toBe('23505');
    });
  });
});

describe('audit retention', { timeout: 30_000 }, () => {
  it('keeps events 12 months when the tenant has no audit rule', async () => {
    await asMigratorInTenant(async (client) => {
      expect(await keptFor(client, '12 months')).toBe(true);
    });
  });

  it("keeps events as long as the tenant's audit rule says", async () => {
    await asMigratorInTenant(async (client) => {
      const { text, values } = insertStatement(client, 'app.retention_policy', policy());
      await client.query(text, values);
      expect(await keptFor(client, '400 days')).toBe(true);
    });
  });

  it('refuses an event kept less than 12 months, even with the trigger off', async () => {
    await asMigratorInTenant(async (client) => {
      await client.query('ALTER TABLE app.audit_event DISABLE TRIGGER set_audit_retention');
      const soon = new Date(Date.now() + 364 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        await outcome(
          client,
          `INSERT INTO app.audit_event
             (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes, retain_until)
           VALUES ($1, $2, 'system', 'platform.tenant.updated', 'platform.tenant', $1, '{}', $3)`,
          [tenant.id, randomUUID(), soon],
        ),
      ).toBe('23514');
    });
  });
});
