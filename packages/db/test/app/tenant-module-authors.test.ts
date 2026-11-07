// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The operator author on app.tenant_module and app.config_version (migration
// 0026, ADR 0024): a row names a membership exactly when its author is a
// user, app_api writes only user rows, an update by app_api makes an
// operator's switch a member's, and a wave 1 switch is kept from every other
// tenant. Since 0040 app_operator, which app_worker may SET ROLE to, adds
// only operator rows that switch a module on, in the tenant set, and never
// changes a row (operator-role.test.ts covers app_worker on its own).

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
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
let member: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}, 30_000);

const switchRow = (change: Row = {}): Row => ({
  tenant_id: tenant.id,
  module: 'crm',
  enabled: true,
  updated_by: member,
  ...change,
});

const versionRow = (change: Row = {}): Row => ({
  tenant_id: tenant.id,
  entity_type: 'platform.modules',
  entity_id: randomUUID(),
  version: 1,
  author_id: member,
  diff: {},
  ...change,
});

/** Like asRoleIn, as app_worker set to app_operator, as withOperator() does. */
const asOperatorIn = <T>(tenantId: string, work: (client: pg.Client) => Promise<T>) =>
  asRoleIn('app_worker', tenantId, async (client) => {
    await client.query('SET LOCAL ROLE app_operator');
    return work(client);
  });

const operatorSwitch = { updated_by: null, updated_by_kind: 'operator' };
const operatorVersion = { author_id: null, author_kind: 'operator' };

describe('app.tenant_module authors', { timeout: 30_000 }, () => {
  it("keeps each tenant's wave 1 switches from every other tenant", async () => {
    await expectCrossTenantDenial('app.tenant_module', async (client, owner) => ({
      tenant_id: owner.id,
      module: 'crm',
      enabled: true,
      updated_by: await addMember(client, owner),
    }));
  });

  it('says in the catalogue that no row means off', async () => {
    const comment = await asRoleIn('app_api', tenant.id, async (client) => {
      const { rows } = await client.query<{ comment: string }>(
        "SELECT pg_catalog.obj_description('app.tenant_module'::regclass, 'pg_class') AS comment",
      );
      return rows[0]?.comment;
    });
    expect(comment).toMatch(/no row, or enabled false, means off/);
  });

  it.each([
    ['an operator switch without a member', operatorSwitch, 'ok'],
    ['an operator switch that names a member', { updated_by_kind: 'operator' }, '23514'],
    ['a user switch without a member', { updated_by: null }, '23514'],
    ['an author kind outside the list', { ...operatorSwitch, updated_by_kind: 'system' }, '23514'],
  ])('as migrator, the checks take %s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.tenant_module', switchRow(change));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('lets app_api write only user switches that name a member', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const [change, expected] of [
        [operatorSwitch, '42501'],
        [{ updated_by_kind: 'user' }, '42501'],
        [{ updated_by: null }, '23514'],
      ] as const) {
        const { text, values } = insertStatement(client, 'app.tenant_module', switchRow(change));
        expect(await outcome(client, text, values), JSON.stringify(change)).toBe(expected);
      }
      const { text, values } = insertStatement(client, 'app.tenant_module', switchRow());
      await client.query(text, values);
      const { rows } = await client.query('SELECT updated_by_kind FROM app.tenant_module');
      expect(rows).toEqual([{ updated_by_kind: 'user' }]);

      const update = (set: string) => outcome(client, `UPDATE app.tenant_module SET ${set}`);
      expect(await update("updated_by_kind = 'operator'")).toBe('42501');
      expect(await update('updated_by = NULL')).toBe('23514');
    });
  });

  it("makes an operator's switch a member's when app_api changes it", async () => {
    const owner = await createTestTenant();
    const [admin, id] = await asMigratorIn(owner.id, async (client) => {
      const by = await addMember(client, owner);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
         VALUES ($1, 'grants', true, 'operator') RETURNING id`,
        [owner.id],
      );
      return [by, rows[0]?.id] as const;
    });
    try {
      await asRoleIn('app_api', owner.id, async (client) => {
        expect(await outcome(client, 'UPDATE app.tenant_module SET enabled = false')).toBe('23514');
        const { rows } = await client.query(
          `UPDATE app.tenant_module SET enabled = false, updated_by = $1
            RETURNING id, enabled, updated_by, updated_by_kind`,
          [admin],
        );
        expect(rows).toEqual([{ id, enabled: false, updated_by: admin, updated_by_kind: 'user' }]);
      });
    } finally {
      // asRoleIn rolls back, so the committed operator switch is still there.
      // Make it a member's, which the trigger turns into a user row, so no
      // operator row is left for 0026's down to refuse (migrations.test.ts).
      const { rowCount } = await asMigratorIn(owner.id, (client) =>
        client.query('UPDATE app.tenant_module SET updated_by = $1 WHERE id = $2', [admin, id]),
      );
      expect(rowCount).toBe(1);
    }
  });
});

describe('app.config_version authors', { timeout: 30_000 }, () => {
  it.each([
    ['an operator version without a member', operatorVersion, 'ok'],
    ['an operator version that names a member', { author_kind: 'operator' }, '23514'],
    ['a user version without a member', { author_id: null }, '23514'],
    ['an author kind outside the list', { ...operatorVersion, author_kind: 'system' }, '23514'],
  ])('as migrator, the checks take %s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.config_version', versionRow(change));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('lets app_api write only user versions that name a member', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const [change, expected] of [
        [operatorVersion, '42501'],
        [{ author_kind: 'user' }, '42501'],
        [{ author_id: null }, '23514'],
      ] as const) {
        const { text, values } = insertStatement(client, 'app.config_version', versionRow(change));
        expect(await outcome(client, text, values), JSON.stringify(change)).toBe(expected);
      }
      const { text, values } = insertStatement(client, 'app.config_version', versionRow());
      await client.query(text, values);
      const { rows } = await client.query('SELECT author_kind FROM app.config_version');
      expect(rows).toEqual([{ author_kind: 'user' }]);
    });
  });
});

describe('app_operator', { timeout: 30_000 }, () => {
  // Only the columns app_operator may write: no membership.
  const workerSwitch = (owner: string, change: Row = {}): Row => ({
    tenant_id: owner,
    module: 'grants',
    enabled: true,
    updated_by_kind: 'operator',
    ...change,
  });
  const workerVersion = (owner: string, change: Row = {}): Row => ({
    tenant_id: owner,
    entity_type: 'platform.module',
    entity_id: randomUUID(),
    version: 1,
    author_kind: 'operator',
    diff: {},
    ...change,
  });

  it('adds an operator switch that turns a module on, and its version', async () => {
    await asOperatorIn(tenant.id, async (client) => {
      for (const [table, row] of [
        ['app.tenant_module', workerSwitch(tenant.id)],
        ['app.config_version', workerVersion(tenant.id)],
      ] as const) {
        const { text, values } = insertStatement(client, table, row);
        expect((await client.query(text, values)).rowCount, table).toBe(1);
      }
      const { rows } = await client.query(
        'SELECT module, enabled, updated_by, updated_by_kind FROM app.tenant_module',
      );
      expect(rows).toEqual([
        { module: 'grants', enabled: true, updated_by: null, updated_by_kind: 'operator' },
      ]);
    });
  });

  it.each([
    ['a user switch', 'app.tenant_module', () => switchRow()],
    [
      'a switch that turns a module off',
      'app.tenant_module',
      () => workerSwitch(tenant.id, { enabled: false }),
    ],
    [
      'a user switch without a member',
      'app.tenant_module',
      () => workerSwitch(tenant.id, { updated_by_kind: 'user' }),
    ],
    ['a user version', 'app.config_version', () => versionRow()],
    [
      'a version of another entity',
      'app.config_version',
      () => workerVersion(tenant.id, { entity_type: 'platform.theme' }),
    ],
    [
      'a user version without a member',
      'app.config_version',
      () => workerVersion(tenant.id, { author_kind: 'user' }),
    ],
  ])('refuses %s', async (_, table, row: () => Row) => {
    await asOperatorIn(tenant.id, async (client) => {
      const { text, values } = insertStatement(client, table, row());
      expect(await outcome(client, text, values)).toBe('42501');
    });
  });

  it('never changes or removes a switch or a version', async () => {
    await asOperatorIn(tenant.id, async (client) => {
      for (const statement of [
        'UPDATE app.tenant_module SET enabled = true',
        'DELETE FROM app.tenant_module',
        'UPDATE app.config_version SET diff = diff',
        'DELETE FROM app.config_version',
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it('keeps an explicit off when it switches on only where no row exists', async () => {
    const owner = await createTestTenant();
    await asMigratorIn(owner.id, async (client) =>
      insertRow(client, 'app.tenant_module', {
        tenant_id: owner.id,
        module: 'grants',
        enabled: false,
        updated_by: await addMember(client, owner),
      }),
    );
    await asOperatorIn(owner.id, async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
         VALUES ($1, 'grants', true, 'operator') ON CONFLICT (tenant_id, module) DO NOTHING`,
        [owner.id],
      );
      expect(rowCount).toBe(0);
      const { rows } = await client.query('SELECT enabled, updated_by_kind FROM app.tenant_module');
      expect(rows).toEqual([{ enabled: false, updated_by_kind: 'user' }]);
    });
  });

  it("cannot read or add another tenant's switches and versions", async () => {
    const [a, b] = [await createTestTenant(), await createTestTenant()];
    await asMigratorIn(a.id, async (client) => {
      await insertRow(client, 'app.tenant_module', workerSwitch(a.id));
      await insertRow(client, 'app.config_version', workerVersion(a.id));
    });
    for (const set of [b.id, '']) {
      await asOperatorIn(set, async (client) => {
        for (const table of ['app.tenant_module', 'app.config_version']) {
          const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1`, [
            a.id,
          ]);
          expect(rowCount, `${table} as ${set || 'no tenant'}`).toBe(0);
        }
        for (const [table, row] of [
          ['app.tenant_module', workerSwitch(a.id, { module: 'crm' })],
          ['app.config_version', workerVersion(a.id)],
        ] as const) {
          const { text, values } = insertStatement(client, table, row);
          expect(await outcome(client, text, values), `${table} as ${set || 'no tenant'}`).toBe(
            '42501',
          );
        }
      });
    }
  });
});
