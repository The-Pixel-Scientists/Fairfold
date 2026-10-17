// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the decision routes use, with the columns they touch (migration
// 0013 and the tables it refers to). Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type {
  ApplicationStatus,
  AssignmentStatus,
  DecisionEmailErrorCode,
  DecisionEmailStatus,
  Outcome,
} from '../../contracts/index.ts';
import { grantsDb, type Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

/** A nullable bigint column: pg reads it as text. */
type Int8 = {
  readonly __select__: string | null;
  readonly __insert__: number | null;
  readonly __update__: number | null;
};

type DecisionTables = {
  'grants.application': {
    id: string;
    round_id: string;
    organisation_id: string;
    applicant_person_id: string;
    status: ApplicationStatus;
    stage_id: string | null;
  };
  'grants.assignment': {
    id: string;
    round_id: string;
    application_id: string;
    status: AssignmentStatus;
  };
  'grants.score': { assignment_id: string; criterion_id: string; score: number };
  'grants.decision': {
    id: Generated<string>;
    tenant_id: string;
    application_id: string;
    outcome: Outcome;
    amount_minor: Int8;
    currency: 'GBP' | null;
    recorded_at: Generated<Date>;
    recorded_by: string;
    released_at: Date | null;
    released_by: string | null;
    created_by: string;
    updated_by: string;
  };
  'grants.decision_email': {
    id: Generated<string>;
    tenant_id: string;
    decision_id: string;
    recipient_person_id: string;
    template_version_id: string;
    status: Generated<DecisionEmailStatus>;
    error_code: Generated<DecisionEmailErrorCode | null>;
    attempts: Generated<number>;
    last_attempt_at: Generated<Date | null>;
    created_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
  'app.audit_event': { id: string; action: string; entity_id: string };
};

/** The transaction typed to the tables the decision routes use. */
export function decisionsDb(tx: Tx) {
  return grantsDb(tx).$extendTables<DecisionTables>();
}

export type DecisionsDb = ReturnType<typeof decisionsDb>;

const UNIQUE_VIOLATION = '23505';

/** Whether a statement failed because a row with the same key was made first. */
export function isDuplicate(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
