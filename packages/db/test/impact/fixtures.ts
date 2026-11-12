// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the impact tests (migration 0067), with plainly synthetic
// values. Rows are added through a client with the tenant set, as migrator.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export const frameworkRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: `Synthetic framework ${randomUUID()}`,
  created_by: member,
  updated_by: member,
  ...change,
});

export const outcomeRow = (tenant: TestTenant, framework: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  id: randomUUID(),
  framework_id: framework,
  name: 'Synthetic outcome',
  position: 0,
  ...change,
});

export const indicatorRow = (
  tenant: TestTenant,
  framework: string,
  outcomeId: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  id: randomUUID(),
  framework_id: framework,
  outcome_id: outcomeId,
  name: 'Synthetic indicator',
  unit: 'count',
  direction: 'increase',
  aggregation: 'sum',
  position: 0,
  ...change,
});

export interface ImpactParts {
  readonly member: string;
  readonly framework: string;
  readonly outcome: string;
  readonly indicator: string;
}

/** A member, and a framework of theirs with one outcome and one indicator, as migrator. */
export async function addImpactParts(
  client: pg.ClientBase,
  tenant: TestTenant,
  unit = 'count',
): Promise<ImpactParts> {
  const member = await addMember(client, tenant, ['programme_manager']);
  const framework = await insertRow(client, 'impact.framework', frameworkRow(tenant, member));
  const outcomeId = await insertRow(client, 'impact.outcome', outcomeRow(tenant, framework));
  const indicator = await insertRow(
    client,
    'impact.indicator',
    indicatorRow(tenant, framework, outcomeId, { unit }),
  );
  return { member, framework, outcome: outcomeId, indicator };
}

const period = (tenant: TestTenant, parts: ImpactParts): Row => ({
  tenant_id: tenant.id,
  framework_id: parts.framework,
  indicator_id: parts.indicator,
  period_start: '2026-04-01',
  period_end: '2027-03-31',
});

export const targetRow = (tenant: TestTenant, parts: ImpactParts, change: Row = {}): Row => ({
  ...period(tenant, parts),
  target: 100,
  created_by: parts.member,
  updated_by: parts.member,
  ...change,
});

export const resultRow = (tenant: TestTenant, parts: ImpactParts, change: Row = {}): Row => ({
  ...period(tenant, parts),
  value: 40,
  recorded_by: parts.member,
  updated_by: parts.member,
  ...change,
});

export const evidenceRow = (
  tenant: TestTenant,
  parts: ImpactParts,
  result: string,
  file: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  framework_id: parts.framework,
  result_id: result,
  file_id: file,
  caption: 'Synthetic survey summary',
  added_by: parts.member,
  ...change,
});

export const noteRow = (tenant: TestTenant, parts: ImpactParts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  framework_id: parts.framework,
  body: 'Synthetic learning note',
  created_by: parts.member,
  ...change,
});

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
