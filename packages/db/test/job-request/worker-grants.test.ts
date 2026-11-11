// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release email handler's rights (migrations 0029 and 0045) and the
// subject access export's reads (migrations 0044, 0046 and 0051): app_worker holds
// exactly these on the grants and party schemas, the audit table and the
// module switches, and, with one tenant set, reaches none of another
// tenant's rows. The score table and an assignment's updated_by are not
// among them (rule 8); the reviewer is readable only for the reminder jobs
// (migration 0061), and the export leaves it out. Audit event changes are
// the export's to filter.
// The cross-tenant tests of grants.decision, grants.decision_email,
// grants.email_template_version, party.person, party.relationship and
// app.audit_event run as every role with a grant, app_worker now included.

import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { addReleased, type Released } from '../grants/decision-fixtures.ts';
import { heldRights } from '../privilege-lint.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';

const ACTORS = ['created_at', 'created_by', 'updated_at', 'updated_by'];

const SUBJECT_ACCESS_READS: Readonly<Record<string, readonly string[]>> = {
  'party.party': ['tenant_id', 'id', 'kind', 'status', 'merged_into', 'erased_at', ...ACTORS],
  'party.relationship': [
    'tenant_id',
    'id',
    ...ACTORS,
    'type',
    'subject_id',
    'subject_kind',
    'object_id',
    'object_kind',
    'starts_on',
    'ends_on',
  ],
  'party.person': ['kind', 'family_name', 'phone', 'user_id', ...ACTORS],
  'party.consent': [
    'tenant_id',
    'id',
    'person_id',
    'purpose',
    'channel',
    'state',
    'privacy_notice_version',
    'source',
    'recorded_at',
    'recorded_by',
  ],
  'party.value_history': [
    'tenant_id',
    'id',
    'party_id',
    'party_kind',
    'field_id',
    'old_value',
    'new_value',
    'changed_by',
    'changed_at',
  ],
  'grants.application': [
    'tenant_id',
    'id',
    ...ACTORS,
    'round_id',
    'form_version_id',
    'applicant_person_id',
    'organisation_id',
    'status',
    'answers',
    'answers_version',
    'stage_id',
    'submitted_at',
    'submitted_late',
    'withdrawn_at',
    'organisation_snapshot_id',
    'submission_route',
  ],
  'grants.form_version': ['tenant_id', 'id', 'definition'],
  'grants.eligibility_result': [
    'tenant_id',
    'id',
    'application_id',
    'form_version_id',
    'outcome',
    'stopping_field_id',
    'checked_at',
    'checked_by',
  ],
  'grants.stage_transition': [
    'tenant_id',
    'id',
    'round_id',
    'application_id',
    'from_stage_id',
    'to_stage_id',
    'moved_at',
    'moved_by',
  ],
  'grants.application_file': [
    'tenant_id',
    'id',
    'application_id',
    'file_id',
    'field_id',
    'created_by',
    'created_at',
  ],
  'grants.assignment': [
    'tenant_id',
    'id',
    'created_at',
    'created_by',
    'updated_at',
    'round_id',
    'application_id',
    'stage_id',
    'status',
    'submitted_at',
  ],
};

const RELEASE_EMAIL_RIGHTS = [
  'USAGE on schema grants',
  'USAGE on schema party',
  'SELECT on grants.decision',
  'SELECT on grants.email_template_version',
  'SELECT on grants.decision_email',
  'UPDATE on column grants.decision_email.status',
  'UPDATE on column grants.decision_email.error_code',
  ...['tenant_id', 'id', 'given_name', 'email'].map(
    (column) => `SELECT on column party.person.${column}`,
  ),
  'SELECT on app.audit_event',
  // Added by migration 0045: which module is on, and the names in the email.
  ...['tenant_id', 'id', 'module', 'enabled'].map(
    (column) => `SELECT on column app.tenant_module.${column}`,
  ),
  ...['tenant_id', 'id', 'programme_id', 'title'].map(
    (column) => `SELECT on column grants.round.${column}`,
  ),
  ...['tenant_id', 'id', 'title'].map((column) => `SELECT on column grants.programme.${column}`),
  ...['tenant_id', 'id', 'name'].map((column) => `SELECT on column party.organisation.${column}`),
  // The subject access export (migration 0044): every classified column of
  // the person's rows, and each pinned form definition. SELECT only.
  ...Object.entries(SUBJECT_ACCESS_READS).flatMap(([table, columns]) =>
    columns.map((column) => `SELECT on column ${table}.${column}`),
  ),
  // The erasure job's functions (migration 0033), its only other rights there.
  'EXECUTE on function grants.clear_answer_fields(uuid,text[])',
  'EXECUTE on function party.erase_party(uuid,uuid)',
  // The erased-party guards call it on the worker's writes (migration 0033).
  'EXECUTE on function party.is_erased(uuid,uuid)',
  // The message notification job (migration 0052).
  'SELECT on grants.application_message',
  'SELECT on grants.message_notification',
  ...['status', 'error_code', 'sent_at'].map(
    (column) => `UPDATE on column grants.message_notification.${column}`,
  ),
  // The saved view CSV export (migration 0059). SELECT only.
  'SELECT on grants.saved_view',
  'SELECT on grants.application_owner',
  'SELECT on grants.label',
  'SELECT on grants.application_label',
  // The reminder jobs (migrations 0060 to 0062): the setting, the outbox
  // they write and deal with, each draft's closing time, each assignment's
  // reviewer, and erasing a reminder's recipient.
  'SELECT on grants.reminder_setting',
  'SELECT on grants.reminder_email',
  ...[
    'tenant_id',
    'kind',
    'application_id',
    'assignment_id',
    'recipient_person_id',
    'template_version_id',
    'occurrence',
  ].map((column) => `INSERT on column grants.reminder_email.${column}`),
  ...['status', 'outcome_code'].map((column) => `UPDATE on column grants.reminder_email.${column}`),
  'SELECT on column grants.round.closes_at',
  ...[
    'tenant_id',
    'id',
    'round_id',
    'organisation_id',
    'application_id',
    'kind',
    'closes_at',
    'revoked_at',
  ].map((column) => `SELECT on column grants.adjustment.${column}`),
  'SELECT on column grants.assignment.reviewer_membership_id',
  'EXECUTE on function grants.erase_reminders(uuid)',
];

/** A released decision, with its applicant as a contact for its organisation. */
async function addLinkedRelease(tenant: TestTenant): Promise<Released & { link: string }> {
  return asMigratorIn(tenant.id, async (client) => {
    const released = await addReleased(client, tenant);
    const link = await insertRow(client, 'party.relationship', {
      tenant_id: tenant.id,
      type: 'contact_for',
      subject_id: released.parts.person,
      subject_kind: 'person',
      object_id: released.parts.organisation,
      object_kind: 'organisation',
    });
    return { ...released, link };
  });
}

describe("app_worker's release email and subject access rights", { timeout: 60_000 }, () => {
  it('are exactly those the jobs need in grants, party and the audit table', () =>
    withClient('migrator', async (client) => {
      const held = (await heldRights(client, ['app_worker']))
        .filter(
          ({ schema, object }) =>
            schema === 'grants' ||
            schema === 'party' ||
            object === 'app.audit_event' ||
            object.startsWith('column app.tenant_module.'),
        )
        .map(({ privilege, object }) => `${privilege} on ${object}`);
      expect(held.sort()).toEqual([...RELEASE_EMAIL_RIGHTS].sort());
    }));

  it("reach one tenant's release and none of another's", async () => {
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    const mine = await addLinkedRelease(tenant);
    const theirs = await addLinkedRelease(other);
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const count = async (table: string, id: string) =>
        (await client.query(`SELECT FROM ${table} WHERE id = $1`, [id])).rowCount;
      expect(await count('grants.decision', mine.decision)).toBe(1);
      expect(await count('grants.decision', theirs.decision)).toBe(0);
      expect(await count('grants.email_template_version', theirs.template)).toBe(0);
      expect(await count('party.person', theirs.parts.person)).toBe(0);
      expect(await count('grants.application', mine.application)).toBe(1);
      expect(await count('grants.application', theirs.application)).toBe(0);
      expect(await count('party.party', theirs.parts.person)).toBe(0);
      expect(await count('app.membership', theirs.manager)).toBe(0);
      expect(await count('party.relationship', mine.link)).toBe(1);
      expect(await count('party.relationship', theirs.link)).toBe(0);
      const linksOf = async (column: string, id: string) =>
        (await client.query(`SELECT FROM party.relationship WHERE ${column} = $1`, [id])).rowCount;
      expect(await linksOf('subject_id', mine.parts.person)).toBe(1);
      expect(await linksOf('object_id', mine.parts.organisation)).toBe(1);
      expect(await linksOf('subject_id', theirs.parts.person)).toBe(0);
      expect(await linksOf('object_id', theirs.parts.organisation)).toBe(0);
      for (const table of ['app.tenant_module', 'party.organisation']) {
        const seen = await client.query(`SELECT FROM ${table} WHERE tenant_id = $1`, [other.id]);
        expect(seen.rowCount, table).toBe(0);
      }
      expect(
        await outcome(client, 'SELECT * FROM party.organisation'),
        'columns it does not need',
      ).toBe('42501');
      expect(
        await outcome(client, 'UPDATE grants.decision SET outcome = outcome'),
        'a decision',
      ).toBe('42501');
      for (const statement of [
        'UPDATE grants.application SET status = status',
        'UPDATE party.person SET family_name = family_name',
        'UPDATE app.membership SET status = status',
        'SELECT token_hash FROM app.invitation',
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it('leave out the score table and who last changed an assignment, and keep the rest', async () => {
    const tenant = await createTestTenant();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      for (const statement of [
        'SELECT score FROM grants.score',
        'SELECT comment FROM grants.score',
        'SELECT id FROM grants.score',
        'SELECT updated_by FROM grants.assignment',
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
      expect(await outcome(client, 'SELECT id, status FROM grants.assignment')).toBe('ok');
    });
  });
});
