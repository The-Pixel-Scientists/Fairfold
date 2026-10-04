// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.membership (migration 0002): isolation, what app_api may write, the
// roles and status checks, and actors from the same tenant only.

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

/** A tenant with an administrator and a reviewer, and a member of another tenant. */
let tenant: TestTenant;
let other: TestTenant;
let admin: string;
let reviewer: string;
let stranger: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  [admin, reviewer] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addMember(client, tenant, ['reviewer']),
  ]);
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

describe('app.membership', { timeout: 30_000 }, () => {
  it("keeps each tenant's members from every other tenant", async () => {
    await expectCrossTenantDenial('app.membership', (_, owner) => ({
      tenant_id: owner.id,
      user_id: randomUUID(),
      roles: ['reviewer'],
    }));
  });

  it('lets app_api add members and change their roles and status, but not delete them', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.membership', {
        tenant_id: tenant.id,
        user_id: randomUUID(),
        roles: ['reviewer'],
        created_by: admin,
        updated_by: admin,
      });
      expect((await client.query(text, values)).rowCount).toBe(1);

      const changed = await client.query(
        `UPDATE app.membership SET roles = '{programme_manager}', status = 'suspended',
                updated_by = $2
          WHERE id = $1
          RETURNING status, updated_by = $2 AS by_admin, updated_at > created_at AS touched`,
        [reviewer, admin],
      );
      expect(changed.rows).toEqual([{ status: 'suspended', by_admin: true, touched: true }]);

      for (const change of [
        'user_id = gen_random_uuid()',
        'tenant_id = tenant_id',
        'created_by = NULL',
        'created_at = now()',
      ]) {
        expect(await outcome(client, `UPDATE app.membership SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.membership')).toBe('42501');
    });
  });

  it.each([
    ['accepts two roles', { roles: ['tenant_admin', 'applicant'] }, 'ok'],
    ['refuses no roles', { roles: [] }, '23514'],
    ['refuses an unknown role', { roles: ['owner'] }, '23514'],
    ['refuses a null role', { roles: [null] }, '23514'],
    ['refuses roles in two dimensions', { roles: [['reviewer']] }, '23514'],
    ['refuses an unknown status', { status: 'deleted' }, '23514'],
    ['refuses a creator from another tenant', { created_by: 'stranger' }, '23503'],
    ['refuses an updater from another tenant', { updated_by: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const actors = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          value === 'stranger' ? stranger : value,
        ]),
      );
      const { text, values } = insertStatement(client, 'app.membership', {
        tenant_id: tenant.id,
        user_id: randomUUID(),
        roles: ['reviewer'],
        ...actors,
      });
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('gives a user one membership per tenant', async () => {
    const user = randomUUID();
    const add = `INSERT INTO app.membership (tenant_id, user_id, roles) VALUES ($1, $2, '{reviewer}')`;
    await asRoleIn('migrator', other.id, async (client) => {
      await client.query(add, [other.id, user]);
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await client.query(add, [tenant.id, user]);
      expect(await outcome(client, add, [tenant.id, user])).toBe('23505');
    });
  });
});
