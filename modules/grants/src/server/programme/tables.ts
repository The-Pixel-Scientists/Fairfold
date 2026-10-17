// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up tables as this module queries them (migration 0009).
// Replace this with the generated types in packages/db/src/generated/grants.ts
// once the db package exports them. Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { Transaction } from '@pixel-scientists/db';

import type { LatePolicy, Outcome, ProgrammeStatus } from '../../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

/** A bigint column: pg reads it as text. */
type Int8 = {
  readonly __select__: string;
  readonly __insert__: number;
  readonly __update__: number;
};

type Actors = { created_by: string | null; updated_by: string | null };

type GrantsTables = {
  'grants.programme': Actors & {
    id: Generated<string>;
    tenant_id: string;
    title: string;
    summary: string;
    description: string;
    status: ProgrammeStatus;
  };
  'grants.round': Actors & {
    id: Generated<string>;
    tenant_id: string;
    programme_id: string;
    title: string;
    opens_at: Date;
    closes_at: Date;
    timezone: string;
    budget_minor: Int8;
    award_min_minor: Int8;
    award_max_minor: Int8;
    currency: Generated<'GBP'>;
    late_policy: LatePolicy;
  };
  'grants.stage': Actors & {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    name: string;
    position: number;
  };
  'grants.rubric_criterion': Actors & {
    id: Generated<string>;
    tenant_id: string;
    stage_id: string;
    label: string;
    guidance: string;
    weight: number;
    scale_min: number;
    scale_max: number;
    position: number;
  };
  'grants.email_template_version': {
    id: Generated<string>;
    tenant_id: string;
    programme_id: string;
    outcome: Outcome;
    version: number;
    subject: string;
    body: string;
    created_by: string | null;
  };
};

/** The transaction typed to the grants tables. */
export function grantsDb(tx: Tx) {
  return tx.$extendTables<GrantsTables>();
}

export type GrantsDb = ReturnType<typeof grantsDb>;

const FOREIGN_KEY_VIOLATION = '23503';

/** Whether a statement failed because something still refers to the row it removed. */
export function isInUse(error: unknown): boolean {
  return (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;
}
