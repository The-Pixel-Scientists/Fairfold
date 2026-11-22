// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the privacy handlers read from the platform (ADR 0016). The module
// never imports from the API: the API passes in what a handler needs from
// the request and from the platform's own tables.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/privacy';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { PrivacyAuditAction } from '../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

/** A table whose date columns are read and written as text, `YYYY-MM-DD`: pg would otherwise read a date as a time in the server's zone. */
type DateText<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: null extends T[P] ? string | null : string;
};

type PrivacyTables = Omit<
  DB,
  'privacy.rights_request' | 'privacy.request_clock_event' | 'privacy.request_task' | 'privacy.dpia'
> & {
  'privacy.rights_request': DateText<DB['privacy.rights_request'], 'received_on' | 'due_on'>;
  'privacy.request_clock_event': DateText<DB['privacy.request_clock_event'], 'occurred_on'>;
  'privacy.request_task': DateText<DB['privacy.request_task'], 'due_on'>;
  'privacy.dpia': DateText<DB['privacy.dpia'], 'review_on'>;
} & { 'app.membership': { id: string; status: string } };

/** The transaction typed to the privacy tables. */
export function privacyDb(tx: Tx) {
  return tx.$extendTables<PrivacyTables>();
}

export type PrivacyDb = ReturnType<typeof privacyDb>;

/** What a handler reads from the request context. */
export interface PrivacyContext {
  readonly audit: {
    record(event: {
      readonly action: PrivacyAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    /** A sensitive read. */
    read(entity: { readonly action: PrivacyAuditAction; readonly entityId: string }): Promise<void>;
  };
  readonly session: { readonly tenant: string };
  readonly membership: { readonly id: string };
}

/** What the platform passes in. */
export interface PrivacyDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words, with the fields at fault. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  readonly tenantTimeZone: (tx: Tx, tenant: string) => Promise<string>;
  /** The one server clock every deadline is judged by, so a test can fix it. */
  readonly now: () => Date;
  /** Bank holidays and other days off, `YYYY-MM-DD`, for the rights request clock. Weekends need no entry. */
  readonly nonWorkingDates: (tx: Tx) => Promise<ReadonlySet<string>>;
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: PrivacyContext;
  readonly input: I;
}

/** What an answer to a replayed idempotent request reads by: the first answer's id. */
export interface ReplayArgs<I> extends Args<I> {
  readonly id: string | null;
}

/** The words of a refusal the contracts have no message for. None repeats what was sent. */
export const refusals = {
  page: 'This page of results is no longer available. Start again from the first page.',
  person: 'Choose a person from your records.',
  assignee: 'Choose an active member of your team.',
  activities: 'Choose processing activities from your records.',
  tooManyTasks: 'This request has the most tasks it can take. Complete or change one of them.',
  clockBusy: 'The clock cannot take this change. Reload the request and try again.',
  erased: "This person's data has been erased, so the text cannot change.",
  alreadyNotified: 'This notification is already recorded and cannot change.',
  alreadySignedOff: 'This assessment is signed off. Reopen it to change it.',
  reviewDate: 'Enter a review date after today.',
  tooLarge: 'The screening answers or risks are too long. Shorten them and try again.',
} as const;

const PG = { foreignKey: '23503', checkViolation: '23514', notInState: '55000' } as const;

const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;

/** Whether a statement failed because a referenced row is not there for this tenant. */
export const isMissingReference = (error: unknown): boolean => codeOf(error) === PG.foreignKey;

/** Whether a trigger refused the change as the row stands (an erased person, a closed clock). */
export const isRefusedByState = (error: unknown): boolean => codeOf(error) === PG.notInState;

/** Whether a check constraint of this name refused the row. */
export const failedCheck = (error: unknown, constraint: string): boolean =>
  codeOf(error) === PG.checkViolation &&
  (error as { constraint?: unknown }).constraint === constraint;

export const iso = (time: Date): string => time.toISOString();

/** An audit event's changes for each column that differs: ids and codes with both values, text by name only. */
export function changedColumns(
  table: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  columns: readonly string[],
  named: readonly string[] = [],
): AuditChanges {
  const changes: Record<string, { before?: unknown; after?: unknown }> = {};
  for (const column of columns) {
    if (before[column] !== after[column]) {
      changes[`${table}.${column}`] = { before: before[column], after: after[column] };
    }
  }
  for (const column of named) {
    if (before[column] !== after[column]) changes[`${table}.${column}`] = {};
  }
  return changes;
}
