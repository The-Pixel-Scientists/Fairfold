// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the grants programme set-up tests (migration 0009): valid
// rows for each table, and helpers that add them through a client with the
// tenant set.

import type pg from 'pg';

import { insertRow, type Row, type TestTenant } from '../tenants.ts';

export const PROGRAMME_TABLES = [
  'grants.programme',
  'grants.round',
  'grants.stage',
  'grants.rubric_criterion',
  'grants.email_template_version',
] as const;

export function programmeRow(tenant: TestTenant, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    title: 'Community Spaces Fund',
    summary: 'Grants for groups that run shared spaces.',
    ...change,
  };
}

export function roundRow(tenant: TestTenant, programmeId: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    programme_id: programmeId,
    title: 'Spring 2027',
    opens_at: '2027-02-02T09:00:00Z',
    closes_at: '2027-03-31T12:00:00+01:00',
    timezone: 'Europe/London',
    budget_minor: 5_000_000,
    award_min_minor: 100_000,
    award_max_minor: 2_500_000,
    late_policy: 'refuse',
    ...change,
  };
}

export function stageRow(tenant: TestTenant, roundId: string, change: Row = {}): Row {
  return { tenant_id: tenant.id, round_id: roundId, name: 'Intake', position: 1, ...change };
}

export function criterionRow(tenant: TestTenant, stageId: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    stage_id: stageId,
    label: 'Need',
    weight: 2,
    position: 1,
    ...change,
  };
}

export function templateRow(tenant: TestTenant, programmeId: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    programme_id: programmeId,
    outcome: 'accepted',
    version: 1,
    subject: '{{programme_title}}: we are offering you a grant',
    body: 'Dear {{given_name}},\n\nWe are pleased to offer you {{award_amount}}.',
    ...change,
  };
}

export function addProgramme(client: pg.ClientBase, tenant: TestTenant): Promise<string> {
  return insertRow(client, 'grants.programme', programmeRow(tenant));
}

export async function addRound(client: pg.ClientBase, tenant: TestTenant): Promise<string> {
  return insertRow(client, 'grants.round', roundRow(tenant, await addProgramme(client, tenant)));
}

export async function addStage(
  client: pg.ClientBase,
  tenant: TestTenant,
  roundId?: string,
  change: Row = {},
): Promise<string> {
  const round = roundId ?? (await addRound(client, tenant));
  return insertRow(client, 'grants.stage', stageRow(tenant, round, change));
}

export async function addCriterion(
  client: pg.ClientBase,
  tenant: TestTenant,
  stageId?: string,
  change: Row = {},
): Promise<string> {
  const stage = stageId ?? (await addStage(client, tenant));
  return insertRow(client, 'grants.rubric_criterion', criterionRow(tenant, stage, change));
}
