// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the assessment routes use, with the columns they touch
// (migration 0012 and the tables it refers to). Replace this with the
// generated types once the db package exports them. Inserts take
// `tenant_id` from `app.current_tenant_id()`, the transaction's own tenant,
// never from a value.

import type { ApplicationStatus, AssignmentStatus } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type AssessmentTables = {
  'grants.programme': { id: string; title: string };
  'grants.round': { id: string; programme_id: string; title: string };
  'grants.stage': { id: string; round_id: string; name: string; position: number };
  'grants.rubric_criterion': {
    id: string;
    stage_id: string;
    label: string;
    guidance: string;
    weight: number;
    scale_min: number;
    scale_max: number;
    position: number;
  };
  'grants.form_version': { id: string; definition: unknown };
  'grants.application': {
    id: string;
    round_id: string;
    form_version_id: string;
    organisation_id: string;
    status: ApplicationStatus;
    answers: unknown;
    stage_id: string | null;
  };
  'grants.reviewer': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    membership_id: string;
    added_by: string;
  };
  'grants.assignment': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    application_id: string;
    reviewer_membership_id: string;
    stage_id: string;
    status: Generated<AssignmentStatus>;
    submitted_at: Date | null;
    created_at: Generated<Date>;
    created_by: string | null;
    updated_by: string | null;
  };
  'grants.conflict_declaration': {
    tenant_id: string;
    assignment_id: string;
    declared_by: string;
  };
  'grants.score': {
    id: Generated<string>;
    tenant_id: string;
    assignment_id: string;
    stage_id: string;
    criterion_id: string;
    score: number;
    comment: string;
    created_by: string | null;
    updated_by: string | null;
  };
  'app.membership': { id: string; user_id: string };
};

/** The transaction typed to the tables the assessment routes use. */
export function assessmentDb(tx: Tx) {
  return tx.$extendTables<AssessmentTables>();
}

export type AssessmentDb = ReturnType<typeof assessmentDb>;

const UNIQUE_VIOLATION = '23505';

/** Whether a statement failed because a row with the same key was made first. */
export function isDuplicate(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
