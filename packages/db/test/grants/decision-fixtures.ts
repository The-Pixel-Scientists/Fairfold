// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the decision tests (migration 0013): a submitted
// application with its programme and a programme manager, a released
// decision on one with its programme's template for the outcome, and rows
// of each decision table, added through a client with the tenant set.

import type pg from 'pg';

import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';
import { addApplication, submit, type Parts } from './application-fixtures.ts';
import { templateRow } from './fixtures.ts';

/** What a decision refers to. */
export interface Submission {
  readonly parts: Parts;
  readonly application: string;
  readonly programme: string;
  readonly manager: string;
}

/** A released decision, and the template version its email uses. */
export interface Released extends Submission {
  readonly decision: string;
  readonly template: string;
}

/** A new application submitted into Review, as migrator. */
export async function addSubmission(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<Submission> {
  const { id, parts } = await addApplication(client, tenant);
  await submit(client, id, parts.stages[1]);
  const { rows } = await client.query<{ programme_id: string }>(
    'SELECT programme_id FROM grants.round WHERE id = $1',
    [parts.round],
  );
  const programme = rows[0]?.programme_id;
  if (programme === undefined) throw new Error('The round has no programme.');
  const manager = await addMember(client, tenant, ['programme_manager']);
  return { parts, application: id, programme, manager };
}

/** Columns app_api may insert for an award of £15,000. */
export function decisionRow(tenant: TestTenant, submission: Submission, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    application_id: submission.application,
    outcome: 'accepted',
    amount_minor: 1_500_000,
    currency: 'GBP',
    recorded_by: submission.manager,
    created_by: submission.manager,
    updated_by: submission.manager,
    ...change,
  };
}

/** Release decision `id` as `member`; the database sets the release time. */
export function release(client: pg.ClientBase, id: string, member: string) {
  return client.query('UPDATE grants.decision SET released_by = $2 WHERE id = $1', [id, member]);
}

/** An award on a new submission, released, with its programme's accepted template, as migrator. */
export async function addReleased(client: pg.ClientBase, tenant: TestTenant): Promise<Released> {
  const submission = await addSubmission(client, tenant);
  const decision = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
  await release(client, decision, submission.manager);
  const template = await insertRow(
    client,
    'grants.email_template_version',
    templateRow(tenant, submission.programme),
  );
  return { ...submission, decision, template };
}

/** Columns app_api may insert for the released decision's email to its applicant. */
export function emailRow(tenant: TestTenant, released: Released, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    decision_id: released.decision,
    recipient_person_id: released.parts.person,
    template_version_id: released.template,
    created_by: released.manager,
    updated_by: released.manager,
    ...change,
  };
}

export function publisherRow(tenant: TestTenant, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    funder_identifier: 'GB-CHC-1234567',
    funder_name: 'Northfield Community Trust',
    identifier_prefix: '360G-northfield',
    ...change,
  };
}
