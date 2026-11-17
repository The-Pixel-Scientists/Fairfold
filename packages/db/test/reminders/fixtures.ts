// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the reminder tests (migrations 0060 to 0062 and 0068): an
// application with an assignment, its programme's template for each reminder
// kind and an accepted one, a setting for its round and rows of the outbox,
// added through a client with the tenant set.

import type pg from 'pg';

import { addAssignment } from '../grants/assessment-fixtures.ts';
import { templateRow } from '../grants/fixtures.ts';
import { insertRow, type Row, type TestTenant } from '../tenants.ts';

/** What a reminder setting and a reminder refer to. */
export interface Reminded {
  readonly member: string;
  readonly programme: string;
  readonly round: string;
  readonly application: string;
  readonly assignment: string;
  readonly person: string;
  readonly draftTemplate: string;
  readonly reviewTemplate: string;
  readonly decisionTemplate: string;
}

/** A template version of `programme` for each reminder kind, as migrator. */
export async function addReminderTemplates(
  client: pg.ClientBase,
  tenant: TestTenant,
  programme: string,
): Promise<Pick<Reminded, 'draftTemplate' | 'reviewTemplate'>> {
  const template = (outcome: string) =>
    insertRow(client, 'grants.email_template_version', templateRow(tenant, programme, { outcome }));
  return {
    draftTemplate: await template('draft_closing'),
    reviewTemplate: await template('review_overdue'),
  };
}

/** A new application under review, with templates of its programme, as migrator. */
export async function addReminded(client: pg.ClientBase, tenant: TestTenant): Promise<Reminded> {
  const { id: assignment, review } = await addAssignment(client, tenant);
  const { rows } = await client.query<{ programme_id: string }>(
    'SELECT programme_id FROM grants.round WHERE id = $1',
    [review.parts.round],
  );
  const programme = rows[0]?.programme_id;
  if (programme === undefined) throw new Error('The round has no programme.');
  return {
    member: review.parts.member,
    programme,
    round: review.parts.round,
    application: review.application,
    assignment,
    person: review.parts.person,
    ...(await addReminderTemplates(client, tenant, programme)),
    decisionTemplate: await insertRow(
      client,
      'grants.email_template_version',
      templateRow(tenant, programme),
    ),
  };
}

/** Columns app_api may insert for a setting with both kinds on. */
export const settingRow = (tenant: TestTenant, to: Reminded, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  round_id: to.round,
  draft_enabled: true,
  draft_days_before_1: 14,
  draft_days_before_2: 7,
  draft_days_before_3: 1,
  draft_template_version_id: to.draftTemplate,
  review_enabled: true,
  review_overdue_after_days: 14,
  review_repeat_every_days: 7,
  review_template_version_id: to.reviewTemplate,
  created_by: to.member,
  updated_by: to.member,
  ...change,
});

/** Columns app_worker may insert for the draft's reminder seven days before it closes. */
export const draftReminder = (
  tenant: TestTenant,
  to: Pick<Reminded, 'application' | 'person' | 'draftTemplate'>,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  kind: 'draft_closing',
  application_id: to.application,
  recipient_person_id: to.person,
  template_version_id: to.draftTemplate,
  occurrence: 7,
  ...change,
});

/** Columns app_worker may insert for the assignment's first overdue reminder. */
export const reviewReminder = (
  tenant: TestTenant,
  to: Pick<Reminded, 'assignment' | 'person' | 'reviewTemplate'>,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  kind: 'review_overdue',
  assignment_id: to.assignment,
  recipient_person_id: to.person,
  template_version_id: to.reviewTemplate,
  occurrence: 1,
  ...change,
});

/** A reminder whose one attempt failed, as migrator writes it for the tests. */
export const FAILED: Row = {
  status: 'failed',
  outcome_code: 'delivery_failed',
  attempts: 1,
  last_attempt_at: new Date(),
};
