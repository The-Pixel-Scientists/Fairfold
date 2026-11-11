// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the crm tests (migration 0063), with plainly synthetic
// values. Rows are added through a client with the tenant set, as migrator.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { addFile } from '../grants/application-fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export const SUMMARY = 'Synthetic call summary';

/** One filter on a party's kind, under a new filter id. */
export const filters = (field = 'kind', operator = 'eq', value = 'person') =>
  JSON.stringify({ [randomUUID()]: { field, operator, value } });

export interface CrmParts {
  readonly member: string;
  readonly person: string;
  readonly organisation: string;
}

/** A member, a person and an organisation, as migrator. */
export async function addCrmParts(client: pg.ClientBase, tenant: TestTenant): Promise<CrmParts> {
  return {
    member: await addMember(client, tenant, ['programme_manager']),
    person: await addPerson(client, tenant),
    organisation: await addOrganisation(client, tenant),
  };
}

export const listRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: `Synthetic list ${randomUUID()}`,
  created_by: member,
  updated_by: member,
  ...change,
});

export const segmentRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: `Synthetic segment ${randomUUID()}`,
  definition: filters(),
  created_by: member,
  updated_by: member,
  ...change,
});

export const noteRow = (
  tenant: TestTenant,
  party: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  party_id: party,
  kind: 'call',
  occurred_at: '2026-11-02T10:00:00Z',
  source_module: 'crm',
  summary: SUMMARY,
  recorded_by: member,
  ...change,
});

export const eventRow = (tenant: TestTenant, party: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  party_id: party,
  kind: 'application_submitted',
  occurred_at: '2026-11-02T10:00:00Z',
  source_module: 'grants',
  source_entity_type: 'grants.application',
  source_entity_id: randomUUID(),
  ...change,
});

export const mergeRow = (
  tenant: TestTenant,
  loser: string,
  survivor: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  kind: 'person',
  action: 'merge',
  loser_id: loser,
  survivor_id: survivor,
  repointed_counts: JSON.stringify({ crm: { 'crm.interaction': 2 } }),
  preview_hash: 'a'.repeat(64),
  merged_by: member,
  ...change,
});

export const importJobRow = (
  tenant: TestTenant,
  file: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  file_id: file,
  target_kind: 'person',
  header_row: true,
  column_mapping: JSON.stringify({ 1: 'given_name', 2: 'family_name', 3: 'email' }),
  requested_by: member,
  ...change,
});

export const importRowRow = (tenant: TestTenant, job: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  job_id: job,
  row_number: 2,
  cells: JSON.stringify({ given_name: 'Ada', family_name: 'Example', email: 'ada@example.test' }),
  errors: '[]',
  ...change,
});

export const referenceRow = (
  tenant: TestTenant,
  party: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  party_id: party,
  system: 'salesforce',
  external_id: `SF-${randomUUID()}`,
  url: 'https://crm.example.test/records/1',
  added_by: member,
  ...change,
});

/** A new import job on a new clean file, as migrator. */
export async function addImportJob(
  client: pg.ClientBase,
  tenant: TestTenant,
  member: string,
): Promise<string> {
  const file = await addFile(client, tenant, member);
  return insertRow(client, 'crm.import_job', importJobRow(tenant, file, member));
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
