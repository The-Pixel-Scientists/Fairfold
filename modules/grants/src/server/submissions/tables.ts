// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the staff submission routes read, with the columns they use
// (migrations 0009 to 0011). Replace this with the generated types once the
// db package exports them. Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { ApplicationStatus, EligibilityOutcome } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

export type SubmissionTables = {
  'grants.programme': { id: string; title: string };
  'grants.round': { id: string; programme_id: string; title: string };
  'grants.stage': { id: string; round_id: string; name: string };
  'grants.form_version': { id: string; version: number; definition: unknown };
  'grants.application': {
    id: string;
    round_id: string;
    form_version_id: string;
    applicant_person_id: string;
    organisation_id: string;
    status: ApplicationStatus;
    answers: unknown;
    /** Set for every submitted or withdrawn application, which are the only ones read here. */
    stage_id: string;
    submitted_at: Date;
    submitted_late: boolean;
    withdrawn_at: Date | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'grants.eligibility_result': {
    id: string;
    application_id: string;
    outcome: EligibilityOutcome;
    stopping_field_id: string | null;
    checked_at: Date;
  };
  'grants.stage_transition': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    application_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    moved_at: Generated<Date>;
    moved_by: string;
  };
  'app.membership': { id: string; user_id: string };
};

/** The transaction typed to the tables the submission routes use. */
export function submissionsDb(tx: Tx) {
  return tx.$extendTables<SubmissionTables>();
}
