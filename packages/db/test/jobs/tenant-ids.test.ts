// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.tenant_ids() (migration 0024): the worker's list of active tenants
// for its per-tenant fan-out. Only app_worker may call it, and it returns
// ids and nothing else.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { asMigratorIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { asRoleRolledBack } from './fixtures.ts';

let active: TestTenant;
let suspended: TestTenant;
beforeAll(async () => {
  [active, suspended] = [await createTestTenant(), await createTestTenant()];
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );
}, 30_000);

describe('app.tenant_ids()', () => {
  it('gives app_worker the ids of active tenants, and no other column', () =>
    withClient('app_worker', async (client) => {
      const result = await client.query<Record<string, unknown>>('SELECT * FROM app.tenant_ids()');
      expect(result.fields.map((field) => field.name)).toEqual(['tenant_ids']);
      const ids = result.rows.map((row) => row.tenant_ids);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(suspended.id);
    }));

  it('works with no tenant set and ignores one that is', () =>
    withClient('app_worker', async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [active.id]);
      const { rows } = await client.query<{ id: string }>('SELECT id FROM app.tenant_ids() AS id');
      await client.query('ROLLBACK');
      expect(rows.length).toBeGreaterThan(1);
    }));

  it.each(['app_api', 'app_queue', 'app_auth'] as const)('refuses %s', (role) =>
    asRoleRolledBack(role, async (client) => {
      expect(await outcome(client, 'SELECT * FROM app.tenant_ids()')).toBe('42501');
    }),
  );
});
