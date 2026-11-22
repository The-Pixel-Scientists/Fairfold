// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the privacy tests (migrations 0089 to 0092), with plainly synthetic
// values. Rows are added through a client with the tenant set, as migrator.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export const SUMMARY = 'Synthetic request for a copy of their records';
export const TITLE = 'Synthetic check of grants records';

export const requestRow = (
  tenant: TestTenant,
  person: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  kind: 'access',
  subject_person_id: person,
  received_at: '2026-11-02T10:00:00Z',
  received_on: '2026-11-02',
  channel: 'email',
  summary: SUMMARY,
  identity_check: 'not_started',
  due_on: '2026-12-02',
  created_by: member,
  updated_by: member,
  ...change,
});

export const eventRow = (
  tenant: TestTenant,
  request: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  request_id: request,
  kind: 'paused',
  occurred_on: '2026-11-03',
  reason_code: 'identity_proof',
  recorded_by: member,
  ...change,
});

export const taskRow = (
  tenant: TestTenant,
  request: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  request_id: request,
  title: TITLE,
  assigned_to: member,
  module_id: 'grants',
  created_by: member,
  updated_by: member,
  ...change,
});

export const breachRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  became_aware_at: '2026-11-02T09:00:00Z',
  discovered_at: '2026-11-02T08:00:00Z',
  description: 'Synthetic email sent to the wrong list',
  data_categories: ['contact'],
  recorded_by: member,
  updated_by: member,
  ...change,
});

export const assessmentRow = (
  tenant: TestTenant,
  breach: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  breach_id: breach,
  risk_level: 'risk',
  notify_ico: true,
  notify_subjects: false,
  assessed_by: member,
  ...change,
});

export const activityRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: `Synthetic activity ${randomUUID()}`,
  purpose: 'Synthetic grant administration',
  legal_basis: 'legitimate_interests',
  created_by: member,
  updated_by: member,
  ...change,
});

export const processorRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: 'Synthetic Hosting Ltd',
  service: 'Synthetic hosting',
  country_code: 'GB',
  created_by: member,
  updated_by: member,
  ...change,
});

export const dpiaRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  title: 'Synthetic DPIA',
  created_by: member,
  updated_by: member,
  ...change,
});

export interface PrivacyParts {
  readonly member: string;
  readonly person: string;
  readonly request: string;
  readonly breach: string;
  readonly activity: string;
  readonly processor: string;
  readonly dpia: string;
}

/** A member and a person, and a request, breach, activity, processor and DPIA, as migrator. */
export async function addPrivacyParts(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<PrivacyParts> {
  const member = await addMember(client, tenant, ['tenant_admin']);
  const person = await addPerson(client, tenant);
  return {
    member,
    person,
    request: await insertRow(client, 'privacy.rights_request', requestRow(tenant, person, member)),
    breach: await insertRow(client, 'privacy.breach', breachRow(tenant, member)),
    activity: await insertRow(client, 'privacy.processing_activity', activityRow(tenant, member)),
    processor: await insertRow(client, 'privacy.processor', processorRow(tenant, member)),
    dpia: await insertRow(client, 'privacy.dpia', dpiaRow(tenant, member)),
  };
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
