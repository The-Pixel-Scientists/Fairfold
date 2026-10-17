// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the application routes add to the programme set-up's (migrations
// 0010 and 0011). Replace this with the
// generated types once the db package exports them. Inserts take `tenant_id`
// from `app.current_tenant_id()`, the transaction's own tenant, never from a
// value.

import type { ApplicationStatus, EligibilityOutcome, Outcome } from '../../contracts/index.ts';
import { grantsDb, type Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

/** A jsonb column, which pg reads as a value and takes as text. */
type Json = {
  readonly __select__: unknown;
  readonly __insert__: string | undefined;
  readonly __update__: string;
};

type ApplicationTables = {
  'grants.form_version': {
    id: string;
    round_id: string;
    version: number;
    status: 'draft' | 'published';
    definition: unknown;
  };
  'grants.application': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    form_version_id: string;
    applicant_person_id: string;
    organisation_id: string;
    status: Generated<ApplicationStatus>;
    answers: Json;
    answers_version: Generated<number>;
    stage_id: Generated<string | null>;
    submitted_at: Generated<Date | null>;
    submitted_late: Generated<boolean>;
    withdrawn_at: Generated<Date | null>;
    updated_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
  'grants.application_file': {
    application_id: string;
    file_id: string;
    field_id: string;
    created_at: Date;
    id: string;
  };
  'grants.decision': {
    application_id: string;
    outcome: Outcome;
    amount_minor: string | null;
    released_at: Date | null;
  };
  'grants.eligibility_result': {
    tenant_id: string;
    application_id: string;
    form_version_id: string;
    outcome: EligibilityOutcome;
    stopping_field_id: string | null;
    checked_by: string;
  };
  'grants.stage_transition': {
    tenant_id: string;
    round_id: string;
    application_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    moved_by: string;
  };
};

/** The transaction typed to the tables the application routes use. */
export function applicationsDb(tx: Tx) {
  return grantsDb(tx).$extendTables<ApplicationTables>();
}

export type ApplicationsDb = ReturnType<typeof applicationsDb>;
