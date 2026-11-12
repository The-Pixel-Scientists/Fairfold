// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared checks for the triage tests (migration 0059), with plainly
// synthetic names.

import { expect } from 'vitest';

import {
  asMigratorIn,
  asRoleIn,
  insertStatement,
  outcome,
  quoteTable,
  type Row,
  type TestTenant,
} from '../tenants.ts';

/** `column` of row `id` holds the database's own time, not the one a caller sent. */
export async function expectDatabaseTime(
  tenant: TestTenant,
  table: string,
  column: string,
  id: string,
): Promise<void> {
  await asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ at: Date }>(
      `SELECT ${client.escapeIdentifier(column)} AS at FROM ${quoteTable(client, table)} WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.at.getTime(), `${table}.${column}`).toBeGreaterThan(Date.now() - 60_000);
  });
}

/** app_worker reads `table` but cannot add `row`, change row `id` through `column`, or delete it. */
export async function expectWorkerReadsOnly(
  tenant: TestTenant,
  table: string,
  id: string,
  column: string,
  row: Row,
): Promise<void> {
  await asRoleIn('app_worker', tenant.id, async (client) => {
    const quoted = quoteTable(client, table);
    const set = client.escapeIdentifier(column);
    const insert = insertStatement(client, table, row);
    expect(await outcome(client, `SELECT 1 FROM ${quoted} WHERE id = $1`, [id])).toBe('ok');
    expect(await outcome(client, insert.text, insert.values)).toBe('42501');
    expect(await outcome(client, `UPDATE ${quoted} SET ${set} = ${set} WHERE id = $1`, [id])).toBe(
      '42501',
    );
    expect(await outcome(client, `DELETE FROM ${quoted} WHERE id = $1`, [id])).toBe('42501');
  });
}
