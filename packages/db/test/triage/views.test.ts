// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.saved_view (migration 0059): denied across tenants, the name,
// filter, sort and column checks, actors kept in the tenant, changed and
// removed by app_api, the database's own times, and read-only for
// app_worker.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { expectDatabaseTime, expectWorkerReadsOnly } from './fixtures.ts';

const TABLE = 'grants.saved_view';

let tenant: TestTenant;
let member: string;
let stranger: string;

const viewRow = (inTenant: TestTenant, by: string, change: Row = {}): Row => ({
  tenant_id: inTenant.id,
  name: 'View 1',
  filter: JSON.stringify({ status: 'submitted', late: true }),
  sort: JSON.stringify({ by: 'submittedAt', direction: 'desc' }),
  columns: ['organisation', 'stage', 'answer.f_name'],
  created_by: by,
  updated_by: by,
  ...change,
});

beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 60_000);

const oversized = JSON.stringify({ status: 'x'.repeat(4100) });

describe(TABLE, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, row) =>
      viewRow(row, await addMember(client, row)),
    ));

  it.each([
    ['a blank name', { name: '   ' }],
    ['an untrimmed name', { name: 'View 1 ' }],
    ['a name over the limit', { name: 'x'.repeat(81) }],
    ['a filter that is not an object', { filter: '[]' }],
    ['an oversized filter', { filter: oversized }],
    ['a sort that is not an object', { sort: '"submittedAt"' }],
    ['an oversized sort', { sort: oversized }],
    ['no columns', { columns: [] }],
    [
      'too many columns',
      { columns: Array.from({ length: 31 }, (_, index) => `c${String(index)}`) },
    ],
    ['a null column', { columns: ['organisation', null] }],
    ['nested columns', { columns: [['organisation'], ['stage']] }],
    ['an oversized column', { columns: ['x'.repeat(2100)] }],
  ])('refuses %s', async (_name, change) => {
    expect(await insertOutcome('app_api', tenant, TABLE, viewRow(tenant, member, change))).toBe(
      '23514',
    );
  });

  it.each(['created_by', 'updated_by'])("refuses another tenant's member in %s", async (column) => {
    const row = viewRow(tenant, member, { [column]: stranger });
    expect(await insertOutcome('app_api', tenant, TABLE, row)).toBe('23503');
  });

  it('is changed and deleted by app_api, which cannot change its creator', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, TABLE, viewRow(tenant, member));
      const change = `UPDATE ${TABLE} SET name = 'View 2', filter = '{}', sort = '{}',
                        columns = '{owner}', updated_by = $2 WHERE id = $1`;
      expect(await outcome(client, change, [id, member])).toBe('ok');
      expect(
        await outcome(client, `UPDATE ${TABLE} SET created_by = created_by WHERE id = $1`, [id]),
      ).toBe('42501');
      expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id])).toBe('ok');
    });
  });

  it('sets created_at and updated_at itself', async () => {
    const at = { created_at: new Date(0), updated_at: new Date(0) };
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, viewRow(tenant, member, at)),
    );
    await expectDatabaseTime(tenant, TABLE, 'created_at', id);
    await asMigratorIn(tenant.id, (client) =>
      client.query(`UPDATE ${TABLE} SET updated_at = $2 WHERE id = $1`, [id, new Date(0)]),
    );
    await expectDatabaseTime(tenant, TABLE, 'updated_at', id);
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        TABLE,
        viewRow(tenant, member, { updated_at: new Date(0) }),
      ),
    ).toBe('42501');
    await expectWorkerReadsOnly(tenant, TABLE, id, 'name', viewRow(tenant, member));
  });
});
