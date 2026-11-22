// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.break_glass (migration 0099): denied across tenants, written by no app
// role and changed or removed by none, its times and retention set by the
// database whatever an insert supplies, and its checks, including the reason
// codes, in step with the domain's list.

import { breakGlassReasons } from '@pixel-scientists/domain/platform/team';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { expectEveryRoleRefused } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { breakGlassRow } from './fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let otherMember: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  otherMember = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 60_000);

/** The SQLSTATE of inserting `row` as migrator, which owns the table, always undone. */
const migratorInsert = (row: Row) =>
  asMigratorIn(tenant.id, (client) => {
    const { text, values } = insertStatement(client, 'app.break_glass', row);
    return outcome(client, text, values);
  });

describe('app.break_glass', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.break_glass', async (client, row) =>
      breakGlassRow(row, await addMember(client, row)),
    ));

  it('is inserted by no app role, even with only the columns a caller would supply', async () => {
    const statement = await withClient('migrator', (client) =>
      Promise.resolve(insertStatement(client, 'app.break_glass', breakGlassRow(tenant, member))),
    );
    await expectEveryRoleRefused(tenant, statement.text, statement.values);
  });

  it('is changed and deleted by no app role', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.break_glass', breakGlassRow(tenant, member)),
    );
    await expectEveryRoleRefused(
      tenant,
      "UPDATE app.break_glass SET expires_at = expires_at + interval '1 day' WHERE id = $1",
      [id],
    );
    await expectEveryRoleRefused(
      tenant,
      'UPDATE app.break_glass SET record_id = record_id WHERE id = $1',
      [id],
    );
    await expectEveryRoleRefused(tenant, 'DELETE FROM app.break_glass WHERE id = $1', [id]);
  });

  it('sets its times and retention itself, ignoring any supplied', async () => {
    const supplied = {
      granted_at: '2020-01-01T00:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      retain_until: '2020-02-01T00:00:00Z',
    };
    const times = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'app.break_glass',
        breakGlassRow(tenant, member, supplied),
      );
      const { rows } = await client.query<{ now: boolean; hour: boolean; kept: boolean }>(
        `SELECT granted_at = now() AS now,
                expires_at = granted_at + interval '1 hour' AS hour,
                retain_until >= ((granted_at AT TIME ZONE 'UTC') + interval '12 months')
                  AT TIME ZONE 'UTC' AS kept
           FROM app.break_glass WHERE id = $1`,
        [id],
      );
      return rows;
    });
    expect(times).toEqual([{ now: true, hour: true, kept: true }]);
  });

  it("refuses another tenant's member, and a repeated id", async () => {
    expect(await migratorInsert(breakGlassRow(tenant, otherMember))).toBe('23503');
    const row = breakGlassRow(tenant, member);
    await asMigratorIn(tenant.id, (client) => insertRow(client, 'app.break_glass', row));
    expect(await migratorInsert(row)).toBe('23505');
  });

  it.each([
    ['an unknown reason code', { reason_code: 'curiosity' }],
    ['a record type out of pattern', { record_type: 'Cases.Case' }],
    ['a record type with no module', { record_type: 'case' }],
    ['a sealed reason too short', { reason_text_ciphertext: Buffer.alloc(47) }],
    ['a sealed reason too long', { reason_text_ciphertext: Buffer.alloc(3029) }],
  ])('refuses %s', async (_name, change) => {
    expect(await migratorInsert(breakGlassRow(tenant, member, change))).toBe('23514');
  });

  it('accepts exactly the reason codes the domain lists', async () => {
    const definition = await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(c.oid) AS definition
           FROM pg_catalog.pg_constraint c
          WHERE c.conrelid = 'app.break_glass'::regclass AND c.contype = 'c'
            AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%reason_code%'`,
      );
      return rows.map((row) => row.definition);
    });
    expect(definition).toHaveLength(1);
    const codes = [...(definition[0] ?? '').matchAll(/'([a-z_]+)'::text/g)].map(
      (match) => match[1],
    );
    expect(codes).toEqual([...breakGlassReasons]);
  });
});
