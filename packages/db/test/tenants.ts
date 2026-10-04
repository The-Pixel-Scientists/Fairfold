// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test fixtures: tenants, and rows in them, committed to the test database
// as migrator. Row-level security is forced on migrator too, so each runs
// with its tenant set, and refuses to run in any database whose name does
// not end in _test.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../scripts/roles.ts';
import { withClient } from './connect.ts';

export type Row = Readonly<Record<string, unknown>>;

export interface TestTenant {
  readonly id: string;
  readonly slug: string;
}

/**
 * Run `work` on `client`, connected as migrator, in one transaction with
 * `tenant` set, and commit it. Refuses unless the database is a test one.
 */
export async function committedIn<T>(
  client: pg.ClientBase,
  tenant: string,
  work: (client: pg.ClientBase) => Promise<T>,
): Promise<T> {
  const { rows } = await client.query<{ database: string }>(
    'SELECT pg_catalog.current_database() AS database',
  );
  const database = rows[0]?.database ?? '';
  if (!database.endsWith('_test')) {
    throw new Error(
      `Test fixtures go only in a database whose name ends in _test, not ${database}.`,
    );
  }
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** committedIn() on a new migrator connection. */
export function asMigratorIn<T>(
  tenant: string,
  work: (client: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withClient('migrator', (client) => committedIn(client, tenant, work));
}

/** Run `work` as `role` in a transaction with `tenant` set, and roll it back. */
export async function asRoleIn<T>(
  role: LoginRole,
  tenant: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** Run one statement in a savepoint that is always undone, and return its SQLSTATE, or ok. */
export async function outcome(
  client: pg.ClientBase,
  text: string,
  values: readonly unknown[] = [],
): Promise<string> {
  await client.query('SAVEPOINT outcome');
  try {
    await client.query(text, [...values]);
    return 'ok';
  } catch (error) {
    const { code } = error as pg.DatabaseError;
    if (!code) throw error;
    return code;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT outcome');
  }
}

/** A slug no other test tenant has. */
export function testSlug(): string {
  return `test-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/** Add a tenant through `client`, connected as migrator, and commit it. */
export async function addTestTenant(client: pg.ClientBase): Promise<TestTenant> {
  const tenant = { id: randomUUID(), slug: testSlug() };
  await committedIn(client, tenant.id, (inTenant) =>
    inTenant.query('INSERT INTO app.tenant (id, slug, name) VALUES ($1, $2, $3)', [
      tenant.id,
      tenant.slug,
      'Test tenant',
    ]),
  );
  return tenant;
}

/**
 * Add an account and commit it, as app_auth, which alone may write
 * auth.user, and return its id.
 */
export function createTestUser(): Promise<string> {
  return withClient('app_auth', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO auth."user" (email) VALUES ($1) RETURNING id',
      [`${testSlug()}@example.test`],
    );
    const [row] = rows;
    if (!row) throw new Error('The insert into auth.user returned no row.');
    return row.id;
  });
}

/** addTestTenant() on a new migrator connection. */
export function createTestTenant(): Promise<TestTenant> {
  return withClient('migrator', addTestTenant);
}

/** A schema-qualified table name, such as app.membership, quoted for SQL. */
export function quoteTable(client: pg.ClientBase, table: string): string {
  return table
    .split('.')
    .map((part) => client.escapeIdentifier(part))
    .join('.');
}

/** `INSERT INTO table (columns) VALUES (...)` for `values`, without RETURNING. */
export function insertStatement(
  client: pg.ClientBase,
  table: string,
  values: Row,
): { text: string; values: unknown[] } {
  const columns = Object.keys(values).map((column) => client.escapeIdentifier(column));
  const parameters = columns.map((_, index) => `$${String(index + 1)}`);
  return {
    text: `INSERT INTO ${quoteTable(client, table)} (${columns.join(', ')}) VALUES (${parameters.join(', ')})`,
    values: Object.values(values),
  };
}

/** Insert `values` into `table` and return the new row's id. */
export async function insertRow(
  client: pg.ClientBase,
  table: string,
  values: Row,
): Promise<string> {
  const statement = insertStatement(client, table, values);
  const { rows } = await client.query<{ id: string }>(
    `${statement.text} RETURNING id`,
    statement.values,
  );
  const [row] = rows;
  if (!row) throw new Error(`The insert into ${table} returned no row.`);
  return row.id;
}

/**
 * Add a new account as a member with `roles` to the tenant set on `client`,
 * and return the membership id.
 */
export async function addMember(
  client: pg.ClientBase,
  tenant: TestTenant,
  roles: readonly string[] = ['tenant_admin'],
): Promise<string> {
  return insertRow(client, 'app.membership', {
    tenant_id: tenant.id,
    user_id: await createTestUser(),
    roles,
  });
}
