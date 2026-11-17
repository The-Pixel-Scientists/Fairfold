// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the reminder handlers and jobs use (migrations 0060, 0061 and
// 0068), with the columns they touch. Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { ReminderKind, ReminderReason } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type ReminderTables = {
  'grants.reminder_setting': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    draft_enabled: boolean;
    draft_days_before_1: number | null;
    draft_days_before_2: number | null;
    draft_days_before_3: number | null;
    draft_template_version_id: string | null;
    review_enabled: boolean;
    review_overdue_after_days: number;
    review_repeat_every_days: number;
    review_template_version_id: string | null;
    version: Generated<number>;
    updated_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
  'grants.reminder_email': {
    id: Generated<string>;
    tenant_id: string;
    kind: ReminderKind;
    application_id: string | null;
    assignment_id: string | null;
    recipient_person_id: string | null;
    template_version_id: string;
    occurrence: number;
    status: Generated<'pending' | 'sent' | 'skipped' | 'failed'>;
    outcome_code: ReminderReason | null;
    last_attempt_at: Date | null;
    sent_at: Date | null;
  };
  'grants.email_template_version': { id: string; outcome: string; subject: string; body: string };
  'grants.round': { id: string; programme_id: string; title: string; closes_at: Date };
  'grants.programme': { id: string; title: string };
  'grants.application': {
    id: string;
    round_id: string;
    organisation_id: string;
    applicant_person_id: string;
    status: string;
  };
  'grants.adjustment': {
    id: string;
    round_id: string;
    organisation_id: string;
    application_id: string | null;
    kind: string;
    closes_at: Date | null;
    revoked_at: Date | null;
  };
  'grants.assignment': {
    id: string;
    round_id: string;
    application_id: string;
    reviewer_membership_id: string;
    status: string;
    created_at: Date;
  };
  'app.membership': { id: string; user_id: string; status: string };
  'app.tenant_module': { module: string; enabled: boolean };
};

export function reminderDb(tx: Tx) {
  return tx.$extendTables<ReminderTables>();
}

export type ReminderDb = ReturnType<typeof reminderDb>;
