// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.application_owner (migration 0059): denied across tenants, every
// key kept in the tenant, one owner per application, the database's own
// assignment time, and read-only for app_worker.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication } from '../grants/application-fixtures.ts';
import { insertOutcome } from '../notes/fixtures.ts';
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
import { expectDatabaseTime, expectWorkerReadsOnly } from './fixtures.ts';

const TABLE = 'grants.application_owner';

let tenant: TestTenant;
let member: string;
let other: string;
let application: string;
let strangers: { member: string; application: string };

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ member, other, application } = await asMigratorIn(tenant.id, async (client) => ({
    member: await addMember(client, tenant, ['programme_manager']),
    other: await addMember(client, tenant, ['programme_manager']),
    application: (await addApplication(client, tenant)).id,
  })));
  strangers = await asMigratorIn(stranger.id, async (client) => ({
    member: await addMember(client, stranger),
    application: (await addApplication(client, stranger)).id,
  }));
}, 60_000);

const ownerRow = (change: Row = {}): Row => ({
  tenant_id: tenant.id,
  application_id: application,
  membership_id: member,
  assigned_by: member,
  ...change,
});

describe(TABLE, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, row) => {
      const owner = await addMember(client, row);
      const { id } = await addApplication(client, row);
      return { tenant_id: row.id, application_id: id, membership_id: owner, assigned_by: owner };
    }));

  it.each([
    ['application_id', () => strangers.application],
    ['membership_id', () => strangers.member],
    ['assigned_by', () => strangers.member],
  ])("refuses another tenant's row in %s", async (column, value) => {
    expect(await insertOutcome('app_api', tenant, TABLE, ownerRow({ [column]: value() }))).toBe(
      '23503',
    );
  });

  it('holds one owner per application, which app_api changes or clears', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const insert = insertStatement(client, TABLE, ownerRow());
      await client.query(insert.text, insert.values);
      expect(await outcome(client, insert.text, insert.values)).toBe('23505');
      const where = 'WHERE tenant_id = $1 AND application_id = $2';
      const keys = [tenant.id, application];
      expect(
        await outcome(client, `UPDATE ${TABLE} SET membership_id = $3, assigned_by = $3 ${where}`, [
          ...keys,
          other,
        ]),
      ).toBe('ok');
      expect(
        await outcome(client, `UPDATE ${TABLE} SET application_id = application_id ${where}`, keys),
      ).toBe('42501');
      expect(await outcome(client, `DELETE FROM ${TABLE} ${where}`, keys)).toBe('ok');
    });
  });

  it('sets assigned_at itself, on insert and on change', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, ownerRow({ assigned_at: new Date(0) })),
    );
    await expectDatabaseTime(tenant, TABLE, 'assigned_at', id);
    await asMigratorIn(tenant.id, (client) =>
      client.query(`UPDATE ${TABLE} SET assigned_at = $2 WHERE id = $1`, [id, new Date(0)]),
    );
    await expectDatabaseTime(tenant, TABLE, 'assigned_at', id);
    expect(
      await insertOutcome('app_api', tenant, TABLE, ownerRow({ assigned_at: new Date(0) })),
    ).toBe('42501');
    await expectWorkerReadsOnly(tenant, TABLE, id, 'membership_id', ownerRow());
  });
});
