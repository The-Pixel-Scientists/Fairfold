// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The operator author on app.tenant_module and app.config_version (migration
// 0026, ADR 0024): a row names a membership exactly when its author is a
// user, app_api writes only user rows, an update by app_api makes an
// operator's switch a member's, app_worker writes neither table, and a wave 1
// switch is kept from every other tenant.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

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

describe('app_worker', { timeout: 30_000 }, () => {
  it('cannot add a switch or a configuration version, even with a tenant set', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      for (const [table, row] of [
        ['app.tenant_module', switchRow(operatorSwitch)],
        ['app.tenant_module', switchRow()],
        ['app.config_version', versionRow(operatorVersion)],
        ['app.config_version', versionRow()],
      ] as const) {
        const { text, values } = insertStatement(client, table, row);
        expect(await outcome(client, text, values), table).toBe('42501');
      }
    });
  });
});
