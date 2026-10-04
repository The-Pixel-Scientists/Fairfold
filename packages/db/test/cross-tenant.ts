// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The cross-tenant denial test that every tenant table needs (architecture
// rule 2), for any table. As each app role with a grant on the table, with
// tenant B set, it proves that tenant A's rows cannot be read, changed,
// removed or added to, and that B's rows cannot be moved to A; with no
// tenant set, that no row matches and nothing can be added. A refused
// statement must fail with 42501, for a missing grant or a row-level
// security policy. The same statements on B's own row show where the role
// does have the right, so a refusal comes from the tenant, not a broken
// query.

import type pg from 'pg';
import { expect } from 'vitest';

import type { LoginRole } from '../scripts/roles.ts';
import { APP_ROLES, withClient } from './connect.ts';
import { tenantColumn } from './schema-lint.ts';
import {
  addTestTenant,
  committedIn,
  insertRow,
  insertStatement,
  quoteTable,
  type Row,
  type TestTenant,
} from './tenants.ts';

/**
 * Column values for a new row of the table in `tenant`. It runs as migrator
 * with that tenant set, so it may first add rows the new one refers to.
 */
export type RowFactory = (client: pg.ClientBase, tenant: TestTenant) => Promise<Row> | Row;

interface Fixtures {
  table: string;
  tenantA: TestTenant;
  tenantB: TestTenant;
  rowA: string;
  rowB: string;
  /** How many rows of the table tenant B has: its row and any the factory added. */
  rowsB: number;
  /** A new row for tenant A, which B tries to add. */
  newRowA: Row;
}

const DENIED = 'denied';

export async function expectCrossTenantDenial(table: string, row: RowFactory): Promise<void> {
  await withClient('migrator', async (migrator) => {
    // A tenant's row is the tenant itself for app.tenant, otherwise a new one.
    const rowOf = async (tenant: TestTenant) =>
      tenantColumn(table) === 'id'
        ? tenant.id
        : committedIn(migrator, tenant.id, async (client) =>
            insertRow(client, table, await row(client, tenant)),
          );
    const tenantA = await addTestTenant(migrator);
    const tenantB = await addTestTenant(migrator);
    const rowA = await rowOf(tenantA);
    const rowB = await rowOf(tenantB);
    const counted = await committedIn(migrator, tenantB.id, (client) =>
      client.query<{ count: string }>(`SELECT count(*) FROM ${quoteTable(client, table)}`),
    );
    const fixtures: Fixtures = {
      table,
      tenantA,
      tenantB,
      rowA,
      rowB,
      rowsB: Number(counted.rows[0]?.count),
      newRowA: await committedIn(migrator, tenantA.id, async (client) => row(client, tenantA)),
    };

    const { rows } = await migrator.query<{ role: LoginRole }>(
      `SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
        WHERE pg_catalog.has_any_column_privilege(r.role, $2::regclass, 'SELECT, INSERT, UPDATE')
           OR pg_catalog.has_table_privilege(r.role, $2::regclass, 'DELETE')`,
      [APP_ROLES, table],
    );
    expect(rows, `no app role has a grant on ${table}`).not.toEqual([]);
    for (const { role } of rows) await expectDenialAs(role, fixtures);

    const kept = await committedIn(migrator, tenantA.id, (client) =>
      client.query(`SELECT 1 FROM ${quoteTable(client, table)} WHERE id = $1`, [fixtures.rowA]),
    );
    expect(kept.rowCount, `tenant A's row in ${table} is still there`).toBe(1);
  });
}

async function expectDenialAs(role: LoginRole, fixtures: Fixtures): Promise<void> {
  const { table, tenantA, tenantB, rowA, rowB, rowsB } = fixtures;
  await withClient(role, async (client) => {
    const quoted = quoteTable(client, table);
    const tenant = client.escapeIdentifier(tenantColumn(table));
    const { rows } = await client.query<{
      select: boolean;
      delete: boolean;
      update: string | null;
    }>(
      `SELECT pg_catalog.has_table_privilege($1::regclass, 'SELECT') AS select,
              pg_catalog.has_table_privilege($1::regclass, 'DELETE') AS delete,
              (SELECT a.attname FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
                  AND a.attname <> $2
                  AND pg_catalog.has_column_privilege(a.attrelid, a.attnum, 'UPDATE')
                ORDER BY a.attnum LIMIT 1) AS update`,
      [table, tenantColumn(table)],
    );
    const can = rows[0];
    if (!can) throw new Error(`Could not read the rights of ${role} on ${table}.`);
    // Set a column the role may update to itself, or else the tenant column.
    const set = client.escapeIdentifier(can.update ?? tenantColumn(table));
    const select = `SELECT 1 FROM ${quoted} WHERE id = $1`;
    const update = `UPDATE ${quoted} SET ${set} = ${set} WHERE id = $1`;
    const remove = `DELETE FROM ${quoted} WHERE id = $1`;
    // These read no column of the rows they change, so PostgreSQL applies
    // only the UPDATE or DELETE policies to them, not the SELECT ones.
    const blindUpdate = `UPDATE ${quoted} SET ${set} = (SELECT own.${set} FROM ${quoted} AS own WHERE own.id = $1)`;
    const blindDelete = `DELETE FROM ${quoted}`;
    const insert = insertStatement(client, table, fixtures.newRowA);
    const seen = (count: number) => (can.select ? count : DENIED);
    const changed = (count: number) => (can.update === null ? DENIED : count);
    const removed = (count: number) => (can.delete ? count : DENIED);
    const run = (text: string, values: readonly unknown[] = []) => attempt(client, text, values);

    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantB.id]);
      expect(await run(select, [rowB]), `${role} reads B's row`).toBe(seen(1));
      expect(await run(update, [rowB]), `${role} updates B's row`).toBe(changed(1));
      expect(await run(remove, [rowB]), `${role} deletes B's row`).toBe(removed(1));

      expect(await run(select, [rowA]), `${role} reads A's row`).toBe(seen(0));
      expect(
        await run(`SELECT 1 FROM ${quoted} WHERE ${tenant} <> $1`, [tenantB.id]),
        `${role} reads any other tenant's row`,
      ).toBe(seen(0));
      expect(await run(update, [rowA]), `${role} updates A's row`).toBe(changed(0));
      expect(
        await run(`UPDATE ${quoted} SET ${tenant} = $1 WHERE id = $2`, [tenantA.id, rowB]),
        `${role} moves B's row to A`,
      ).toBe(DENIED);
      expect(await run(remove, [rowA]), `${role} deletes A's row`).toBe(removed(0));
      expect(await run(insert.text, insert.values), `${role} adds a row to A`).toBe(DENIED);
      expect(await run(blindUpdate, [rowB]), `${role} updates every row`).toBe(changed(rowsB));
      expect(await run(blindDelete), `${role} deletes every row`).toBe(removed(rowsB));

      await client.query("SELECT pg_catalog.set_config('app.tenant_id', '', true)");
      expect(await run(`SELECT 1 FROM ${quoted}`), `${role} reads, no tenant`).toBe(seen(0));
      expect(await run(blindUpdate, [rowB]), `${role} updates, no tenant`).toBe(changed(0));
      expect(await run(blindDelete), `${role} deletes, no tenant`).toBe(removed(0));
      expect(await run(insert.text, insert.values), `${role} adds, no tenant`).toBe(DENIED);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** Run one statement in a savepoint that is always undone: its row count, or DENIED for 42501. */
async function attempt(
  client: pg.ClientBase,
  text: string,
  values: readonly unknown[],
): Promise<number | typeof DENIED> {
  await client.query('SAVEPOINT attempt');
  try {
    return (await client.query(text, [...values])).rowCount ?? 0;
  } catch (error) {
    if ((error as pg.DatabaseError).code === '42501') return DENIED;
    throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
  }
}
