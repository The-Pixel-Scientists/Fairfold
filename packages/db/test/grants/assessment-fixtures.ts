// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the assessment tests (migration 0012): an application
// submitted into its round's Review stage, a reviewer in the round's pool,
// two criteria on Review and one on Intake, and rows of each assessment
// table, added through a client with the tenant set.

import type pg from 'pg';

import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';
import { addApplication, submit, type Parts } from './application-fixtures.ts';
import { addCriterion } from './fixtures.ts';

/** What an assignment and its scores refer to. */
export interface Review {
  readonly parts: Parts;
  readonly application: string;
  readonly reviewer: string;
  /** Two criteria of the Review stage, then one of Intake. */
  readonly criteria: readonly [string, string, string];
}

export function reviewerRow(
  tenant: TestTenant,
  round: string,
  membership: string,
  addedBy: string,
): Row {
  return { tenant_id: tenant.id, round_id: round, membership_id: membership, added_by: addedBy };
}

/** Everything a new assignment at Review needs, as migrator. */
export async function addReview(client: pg.ClientBase, tenant: TestTenant): Promise<Review> {
  const { id: application, parts } = await addApplication(client, tenant);
  await submit(client, application, parts.stages[1]);
  const reviewer = await addMember(client, tenant, ['reviewer']);
  await insertRow(
    client,
    'grants.reviewer',
    reviewerRow(tenant, parts.round, reviewer, parts.member),
  );
  const criteria = [
    await addCriterion(client, tenant, parts.stages[1], { label: 'Need', position: 1 }),
    await addCriterion(client, tenant, parts.stages[1], { label: 'Approach', position: 2 }),
    await addCriterion(client, tenant, parts.stages[0], { label: 'Fit', position: 1 }),
  ] as const;
  return { parts, application, reviewer, criteria };
}

/** Columns app_api may insert for an assignment of the reviewer at Review. */
export function assignmentRow(tenant: TestTenant, review: Review, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    round_id: review.parts.round,
    application_id: review.application,
    reviewer_membership_id: review.reviewer,
    stage_id: review.parts.stages[1],
    created_by: review.parts.member,
    updated_by: review.parts.member,
    ...change,
  };
}

/** Columns app_api may insert for a score of `assignment` on the first criterion. */
export function scoreRow(
  tenant: TestTenant,
  review: Review,
  assignment: string,
  change: Row = {},
): Row {
  return {
    tenant_id: tenant.id,
    assignment_id: assignment,
    stage_id: review.parts.stages[1],
    criterion_id: review.criteria[0],
    score: 4,
    comment: 'Clear evidence that the hall is used every day.',
    created_by: review.reviewer,
    updated_by: review.reviewer,
    ...change,
  };
}

/** A new assignment on a new review, as migrator, and what it refers to. */
export async function addAssignment(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<{ id: string; review: Review }> {
  const review = await addReview(client, tenant);
  return {
    id: await insertRow(client, 'grants.assignment', assignmentRow(tenant, review)),
    review,
  };
}
