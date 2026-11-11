// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the assure tests (migrations 0053 to 0058), with invented
// names and list entries only: never a real designation. Rows are added
// through a client connected as migrator with the tenant set.

import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { addFile } from '../grants/application-fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';

export const OFFICER_NAME = 'Synthetic Officer Name';
export const SCREENED_NAME = 'Synthetic Screened Name';
export const ANSWER_TEXT = 'Synthetic answer text';
export const FINDINGS = 'Synthetic findings';

const REFERENCE_TABLES = ['assure.reference_list', 'assure.sanctions_entry'];

/**
 * Run `work` with row-level security lifted from the reference tables, which
 * no role may write until the list loader exists (S12-26). The change is in
 * the caller's transaction, so no other session sees it.
 */
async function withReferenceWrites<T>(client: pg.ClientBase, work: () => Promise<T>): Promise<T> {
  for (const table of REFERENCE_TABLES) {
    await client.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
  }
  const result = await work();
  for (const table of REFERENCE_TABLES) {
    await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }
  return result;
}

/** A superseded list version, so it never clashes with another test's current one. */
export function addList(client: pg.ClientBase, change: Row = {}): Promise<string> {
  return withReferenceWrites(client, () =>
    insertRow(client, 'assure.reference_list', {
      source: 'uk_sanctions_list',
      published_on: '2026-11-01',
      downloaded_at: '2026-11-01T06:00:00Z',
      last_checked_at: '2026-11-01T06:00:00Z',
      sha256: randomBytes(32),
      row_count: 1,
      superseded_at: '2026-11-02T06:00:00Z',
      ...change,
    }),
  );
}

export function entryRow(list: string, change: Row = {}): Row {
  return {
    list_id: list,
    designation_id: 'TST0001',
    entry_kind: 'individual',
    name_type: 'primary',
    name: 'Invented Listed Person',
    normalised_name: 'invented listed person',
    regime: 'Synthetic regime',
    dates_of_birth: ['1970', '1970-01-02'],
    nationalities: ['Invented country'],
    ...change,
  };
}

export function addEntry(client: pg.ClientBase, list: string, change: Row = {}): Promise<string> {
  return withReferenceWrites(client, () =>
    insertRow(client, 'assure.sanctions_entry', entryRow(list, change)),
  );
}

export function snapshotRow(tenant: TestTenant, organisation: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    organisation_id: organisation,
    registry: 'charity_commission',
    scheme: 'GB-CHC',
    identifier: '1234567',
    outcome: 'found',
    registry_status: 'registered',
    registered_name: 'Synthetic Charity',
    address_line1: '1 Synthetic Street',
    address_town: 'Testtown',
    address_postcode: 'ZZ1 1ZZ',
    address_country_code: 'GB',
    ...change,
  };
}

export async function addSnapshot(client: pg.ClientBase, tenant: TestTenant, change: Row = {}) {
  const organisation = await addOrganisation(client, tenant);
  const snapshot = await insertRow(
    client,
    'assure.lookup_snapshot',
    snapshotRow(tenant, organisation, change),
  );
  return { organisation, snapshot };
}

export const officerRow = (tenant: TestTenant, snapshot: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  snapshot_id: snapshot,
  name: OFFICER_NAME,
  role: 'trustee',
  ...change,
});

export const runRow = (tenant: TestTenant, party: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  party_id: party,
  trigger: 'submission',
  ...change,
});

export async function addRun(client: pg.ClientBase, tenant: TestTenant) {
  const party = await addOrganisation(client, tenant);
  return { party, run: await insertRow(client, 'assure.screening_run', runRow(tenant, party)) };
}

export function matchRow(
  tenant: TestTenant,
  run: string,
  party: string,
  list: string,
  change: Row = {},
): Row {
  return {
    tenant_id: tenant.id,
    run_id: run,
    party_id: party,
    name_source: 'registered_name',
    subject_party_id: party,
    screened_name: SCREENED_NAME,
    list_id: list,
    designation_id: 'TST0001',
    entry_kind: 'entity',
    entry_name: 'Invented Listed Entity',
    regime: 'Synthetic regime',
    similarity: 0.6,
    ...change,
  };
}

/**
 * A match on a new run, against `list`. Lists are added before any role's
 * transaction opens: adding one lifts row-level security, which waits for
 * every open reader of the reference tables.
 */
export async function addMatch(
  client: pg.ClientBase,
  tenant: TestTenant,
  list: string,
  change: Row = {},
) {
  const { party, run } = await addRun(client, tenant);
  const match = await insertRow(
    client,
    'assure.screening_match',
    matchRow(tenant, run, party, list, change),
  );
  return { party, run, match };
}

export const ITEM_ID = '0b9f3c1e-5d2a-4b7e-9c1f-2a3b4c5d6e7f';
export const ITEMS = [
  { id: ITEM_ID, label: 'Accounts checked', help: '', kind: 'short_text', required: true },
];

export const versionRow = (
  tenant: TestTenant,
  checklist: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  checklist_id: checklist,
  version: 1,
  name: 'Synthetic checklist',
  items: JSON.stringify(ITEMS),
  published_by: member,
  ...change,
});

/** A checklist with its first version published and current. */
export async function addChecklist(client: pg.ClientBase, tenant: TestTenant, name?: string) {
  const member = await addMember(client, tenant, ['programme_manager']);
  const checklist = await insertRow(client, 'assure.checklist', {
    tenant_id: tenant.id,
    name: name ?? `Synthetic checklist ${randomBytes(4).toString('hex')}`,
    created_by: member,
    updated_by: member,
  });
  const version = await insertRow(
    client,
    'assure.checklist_version',
    versionRow(tenant, checklist, member),
  );
  await client.query('UPDATE assure.checklist SET current_version = 1 WHERE id = $1', [checklist]);
  return { member, checklist, version };
}

export const responseRow = (
  tenant: TestTenant,
  application: string,
  added: { member: string; checklist: string; version: string },
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  application_id: application,
  checklist_id: added.checklist,
  checklist_version_id: added.version,
  answers: JSON.stringify({ [ITEM_ID]: { kind: 'short_text', value: ANSWER_TEXT } }),
  saved_by: added.member,
  ...change,
});

export const visitRow = (
  tenant: TestTenant,
  organisation: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  organisation_id: organisation,
  visited_on: '2026-11-02',
  visit_type: 'in_person',
  findings: FINDINGS,
  follow_ups: JSON.stringify([{ action: 'Send the accounts', dueOn: null, done: false }]),
  recorded_by: member,
  updated_by: member,
  ...change,
});

/** A visit to a new organisation by a new member. */
export async function addVisit(client: pg.ClientBase, tenant: TestTenant) {
  const member = await addMember(client, tenant, ['programme_manager']);
  const organisation = await addOrganisation(client, tenant);
  const visit = await insertRow(
    client,
    'assure.monitoring_visit',
    visitRow(tenant, organisation, member),
  );
  return { member, organisation, visit };
}

export { addFile, addPerson };
