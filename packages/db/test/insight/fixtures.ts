// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the insight tests (migration 0080), with plainly synthetic
// values. Rows are added through a client with the tenant set, as migrator.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export const definitionRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  kind: 'warehouse',
  name: `Synthetic report ${randomUUID()}`,
  definition: { description: null, source: 'grants', measures: {}, groupBy: {}, filters: {} },
  created_by: member,
  updated_by: member,
  ...change,
});

export const ruleRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  threshold: 10,
  minimum_group: 20,
  created_by: member,
  updated_by: member,
  ...change,
});

export const runRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  kind: 'three_sixty_giving',
  period_start: '2026-04-01',
  period_end: '2027-03-31',
  prepared_by: member,
  ...change,
});

export interface InsightParts {
  readonly member: string;
  readonly file: string;
}

/** A member and a clean file of theirs, as migrator. */
export async function addInsightParts(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<InsightParts> {
  const member = await addMember(client, tenant, ['tenant_admin']);
  return { member, file: await addFile(client, tenant, member) };
}

/** Files a run must not take, by what is wrong with each, as migrator. */
export async function addRefusedFiles(
  client: pg.ClientBase,
  tenant: TestTenant,
  member: string,
): Promise<Record<string, string>> {
  const application = await addApplication(client, tenant);
  const add = (state?: 'pending' | 'infected') => addFile(client, tenant, member, state);
  const attach = (file: string) =>
    insertRow(client, 'grants.application_file', {
      tenant_id: tenant.id,
      application_id: application.id,
      file_id: file,
      field_id: `f_${file.slice(0, 8)}`,
      created_by: application.parts.member,
    });
  const files = {
    pending: await add('pending'),
    infected: await add('infected'),
    withheld: await add(),
    erased: await add(),
    linked: await add(),
    released: await add(),
  };
  await client.query(
    "UPDATE app.file SET scan_state = 'withheld', storage_key = $2, scan_version = 2 WHERE id = $1",
    [files.withheld, `withheld/${tenant.id}/${files.withheld}`],
  );
  await client.query('UPDATE app.file SET erased_at = now() WHERE id = $1', [files.erased]);
  await attach(files.linked);
  await client.query('DELETE FROM grants.application_file WHERE id = $1', [
    await attach(files.released),
  ]);
  return files;
}

/** The SQLSTATE of inserting `row` into `table` as `role`, always undone, or ok. */
export function insertOutcome(
  role: LoginRole,
  tenant: TestTenant,
  table: string,
  row: Row,
): Promise<string> {
  return asRoleIn(role, tenant.id, (client) => {
    const { text, values } = insertStatement(client, table, row);
    return outcome(client, text, values);
  });
}
