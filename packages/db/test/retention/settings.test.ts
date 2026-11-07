// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.retention_policy as migration 0032 leaves it: the classification map,
// the retention contracts and the database's checks agree on the policies
// and their minimums; app_api adds and changes only its own tenant's
// settings and never removes one; app_worker writes none; and a changed
// audit setting applies only to events written after it. The cross-tenant
// denial test of the table is in test/app/audit-retention.test.ts.

import { randomUUID } from 'node:crypto';

import { retentionPolicyLabels } from '@pixel-scientists/domain/platform/retention';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { classification } from '../../classification.ts';
import { asMigratorRolledBack, withClient } from '../connect.ts';
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

/** Each policy the map's tenant_policy rules name, with every minimum they give it. */
const mapPolicies = new Map<string, Set<number>>();
for (const columns of Object.values(classification)) {
  for (const { retention } of Object.values(columns)) {
    if (retention.kind !== 'tenant_policy') continue;
    const minimums = mapPolicies.get(retention.policy) ?? new Set<number>();
    mapPolicies.set(retention.policy, minimums.add(retention.minimumDays));
  }
}

/** The database's checks on app.retention_policy, by name. */
async function checks(): Promise<Map<string, string>> {
  const { rows } = await withClient('migrator', (client) =>
    client.query<{ name: string; definition: string }>(
      `SELECT conname AS name, pg_catalog.pg_get_constraintdef(oid) AS definition
         FROM pg_catalog.pg_constraint
        WHERE conrelid = 'app.retention_policy'::regclass AND contype = 'c'`,
    ),
  );
  return new Map(rows.map(({ name, definition }) => [name, definition]));
}

let tenant: TestTenant;
let member: string;
let other: TestTenant;
let otherMember: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  otherMember = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function setting(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    policy: 'audit',
    days: 400,
    created_by: member,
    updated_by: member,
    ...change,
  };
}

function add(client: pg.ClientBase, change: Row = {}): Promise<string> {
  const { text, values } = insertStatement(client, 'app.retention_policy', setting(change));
  return outcome(client, text, values);
}

describe('retention policies', { timeout: 30_000 }, () => {
  it('have one minimum each in the map', () => {
    expect([...mapPolicies.keys()]).not.toEqual([]);
    for (const [policy, minimums] of mapPolicies) expect(minimums.size, policy).toBe(1);
  });

  it('are exactly those the map names, and include every policy the contracts label', async () => {
    const definition = (await checks()).get('retention_policy_policy_check') ?? '';
    const admitted = [...definition.matchAll(/'([a-z0-9_]+)'::text/g)].map((match) => match[1]);
    expect(admitted.sort()).toEqual([...mapPolicies.keys()].sort());
    for (const policy of Object.keys(retentionPolicyLabels)) expect(admitted).toContain(policy);
  });

  it("keep each policy's database minimum equal to the map's", async () => {
    const all = await checks();
    for (const [policy, minimums] of mapPolicies) {
      const definition = all.get(`retention_policy_${policy}_minimum`) ?? '';
      expect(definition, policy).toContain(`(policy <> '${policy}'::text)`);
      expect(definition.match(/days >= (\d+)/)?.[1], policy).toBe(String([...minimums][0]));
    }
  });

  it('refuse a setting below its minimum, added or changed, for every policy', async () => {
    for (const [policy, minimums] of mapPolicies) {
      const minimum = [...minimums][0] ?? 0;
      await asMigratorRolledBack(async (client) => {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        expect(await add(client, { policy, days: minimum - 1 }), policy).toBe('23514');
        await insertRow(client, 'app.retention_policy', setting({ policy, days: minimum }));
        expect(
          await outcome(client, 'UPDATE app.retention_policy SET days = $1 WHERE policy = $2', [
            minimum - 1,
            policy,
          ]),
          policy,
        ).toBe('23514');
      });
    }
  });
});

describe('retention settings', { timeout: 30_000 }, () => {
  it("let app_api add and change its own tenant's setting, and never remove one", async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.retention_policy', setting());
      await client.query(text, values);
      const changed = await client.query<{ days: number }>(
        'UPDATE app.retention_policy SET days = 500, updated_by = $1 RETURNING days',
        [member],
      );
      expect(changed.rows).toEqual([{ days: 500 }]);
      expect(await outcome(client, 'DELETE FROM app.retention_policy')).toBe('42501');
    });
  });

  it('give app_api no say over ids, tenants, policies, authors or times', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const change of [
        { id: randomUUID() },
        { created_at: '2020-01-01' },
        { updated_at: '2020-01-01' },
      ]) {
        expect(await add(client, change), Object.keys(change)[0]).toBe('42501');
      }
      await insertRow(client, 'app.retention_policy', setting());
      for (const set of [
        `tenant_id = '${other.id}'`,
        "policy = 'audit'",
        `created_by = '${member}'`,
        'created_at = now()',
        'updated_at = now()',
      ]) {
        expect(await outcome(client, `UPDATE app.retention_policy SET ${set}`), set).toBe('42501');
      }
    });
  });

  it("refuse app_api a setting in another tenant, or one naming another tenant's member", async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(
        await add(client, {
          tenant_id: other.id,
          created_by: otherMember,
          updated_by: otherMember,
        }),
      ).toBe('42501');
      expect(await add(client, { created_by: otherMember, updated_by: otherMember })).toBe('23503');
    });
  });

  it('let app_worker read the settings and write none', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await add(client)).toBe('42501');
      expect(await outcome(client, 'UPDATE app.retention_policy SET days = 500')).toBe('42501');
      expect(await outcome(client, 'DELETE FROM app.retention_policy')).toBe('42501');
      expect(await outcome(client, 'SELECT days FROM app.retention_policy')).toBe('ok');
    });
  });

  it('apply a changed audit setting only to events written after the change', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const event = async () => {
        const { rows } = await client.query<{ id: string; days: number }>(
          `INSERT INTO app.audit_event
             (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
           VALUES ($1, $2, 'system', 'platform.tenant.updated', 'platform.tenant', $1, '{}')
           RETURNING id, extract(day FROM retain_until - occurred_at)::integer AS days`,
          [tenant.id, randomUUID()],
        );
        return rows[0];
      };
      const kept = async (id: string | undefined) =>
        (
          await client.query<{ days: number }>(
            `SELECT extract(day FROM retain_until - occurred_at)::integer AS days
               FROM app.audit_event WHERE id = $1`,
            [id],
          )
        ).rows[0]?.days;

      await insertRow(client, 'app.retention_policy', setting({ days: 400 }));
      const before = await event();
      await client.query('UPDATE app.retention_policy SET days = 800, updated_by = $1', [member]);
      const after = await event();
      expect(before?.days).toBe(400);
      expect(after?.days).toBe(800);
      expect(await kept(before?.id)).toBe(400);
    });
  });
});
