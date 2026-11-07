// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the erasure tests (migration 0033): a running erasure
// request, and the erasure functions called as app_worker and committed.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { withClient } from '../connect.ts';
import { committedIn, insertRow, type Row, type TestTenant } from '../tenants.ts';

export const ERASE = 'SELECT party.erase_party($1, $2) AS counts';
export const CLEAR = 'SELECT grants.clear_answer_fields($1, $2) AS cleared';
export const DESTROY = 'SELECT app.destroy_subject_key($1) AS destroyed';

/**
 * An erasure request by `member` naming `party`, as the API writes it, then
 * started as the worker starts it. Returns its id.
 */
export async function addErasureRequest(
  client: pg.ClientBase,
  tenant: TestTenant,
  member: string,
  party: string,
  change: Row = {},
): Promise<string> {
  const id = await insertRow(client, 'app.job_request', {
    tenant_id: tenant.id,
    kind: 'erasure',
    requested_by: member,
    permission: 'platform.erasure.request',
    filters: JSON.stringify({ partyId: party, reason: 'subject_request' }),
    field_ids: ['party.person.email'],
    output_sensitivity: 'personal',
    request_id: randomUUID(),
    ...change,
  });
  await client.query("UPDATE app.job_request SET status = 'running' WHERE id = $1", [id]);
  return id;
}

/** Run one statement as `role` in `tenant`, or none, and commit: its first row, or its SQLSTATE. */
export function callAs(
  role: LoginRole,
  tenant: TestTenant | undefined,
  text: string,
  values: readonly unknown[],
): Promise<{ row?: Row; code?: string }> {
  return withClient(role, async (client) => {
    const run = async (inTenant: pg.ClientBase) => {
      try {
        return { row: (await inTenant.query<Row>(text, [...values])).rows[0] };
      } catch (error) {
        const { code } = error as pg.DatabaseError;
        if (!code) throw error;
        return { code };
      }
    };
    if (!tenant) return run(client);
    await client.query('BEGIN');
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    const result = await run(client);
    await client.query(result.code ? 'ROLLBACK' : 'COMMIT');
    return result;
  });
}

/** Erase `party` under `request` as app_worker in `tenant`, and commit. */
export function erase(tenant: TestTenant, party: string, request: string) {
  return callAs('app_worker', tenant, ERASE, [party, request]);
}

/** Every row of `table` in `tenant` whose `column` is `id`, as migrator, ordered by id. */
export function rowsOf(tenant: TestTenant, table: string, column: string, id: string) {
  return withClient('migrator', (client) =>
    committedIn(client, tenant.id, async (inTenant) => {
      const { rows } = await inTenant.query<Row>(
        `SELECT * FROM ${table} WHERE ${column} = $1 ORDER BY id`,
        [id],
      );
      return rows;
    }),
  );
}
