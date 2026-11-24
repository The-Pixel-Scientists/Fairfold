// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the checklist handlers read from the platform (ADR 0016). The module
// never imports from the API or from grants: the API passes in what a
// handler needs from the request and from other modules.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/assure';

import type { AssureAuditAction } from '../../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

/** The file columns a link is checked against (ADR 0030). */
export type FileTables = {
  'app.file': {
    id: string;
    scan_state: string;
    linked_at: Date | null;
    erased_at: Date | null;
  };
};

/** A visit's date is read and compared as text, `YYYY-MM-DD`: pg would otherwise read it in the server's zone. */
type Tables = Omit<DB, 'assure.monitoring_visit'> & {
  'assure.monitoring_visit': Omit<DB['assure.monitoring_visit'], 'visited_on'> & {
    visited_on: string;
  };
} & FileTables;

/** The transaction typed to the assure tables and the file columns. */
export const assureDb = (tx: Tx) => tx.$extendTables<Tables>();

export type AssureDb = ReturnType<typeof assureDb>;

/** One changed path of a checklist, as `app.config_version` holds it. */
export interface ChecklistChange {
  readonly path: string;
  readonly from: string | number | boolean | null;
  readonly to: string | number | boolean | null;
}

/** What a handler reads from the request context. */
export interface ChecklistContext {
  readonly audit: {
    record(event: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId?: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    read(entity: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId: string;
    }): Promise<void>;
  };
  /** Writes the checklist's next configuration version (rule 10) in the request's transaction. */
  readonly config: {
    record(
      entityType: 'assure.checklist',
      entityId: string,
      diff: ChecklistChange[],
    ): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

/** Who an application is from: grants' answer, ids only. */
export interface Applicant {
  readonly organisationId: string;
  readonly applicantPersonId: string;
}

/** What the platform passes in. */
export interface ChecklistDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
  /**
   * The application's organisation and applicant, through grants' server
   * (ADR 0016): null when the tenant has no such application, it is a draft,
   * or grants is off.
   */
  readonly readApplicant: (tx: Tx, applicationId: string) => Promise<Applicant | null>;
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: ChecklistContext;
  readonly input: I;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_IN_STATE = '55000';

const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;

/** Whether a statement failed because a row like it is already there. */
export const isTaken = (error: unknown): boolean => codeOf(error) === UNIQUE_VIOLATION;

/** Whether a statement failed because a record it names is not there, or is another tenant's. */
export const isMissingReference = (error: unknown): boolean =>
  codeOf(error) === FOREIGN_KEY_VIOLATION;

/** Whether a check or trigger refused a change the server could not foresee, such as a lost race or an erased party. */
export const isRefusedByRule = (error: unknown): boolean =>
  codeOf(error) === CHECK_VIOLATION || codeOf(error) === NOT_IN_STATE;

/** A value as JSON with object keys in order, so equal values compare equal whatever order jsonb gave their keys. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

export const iso = (time: Date): string => time.toISOString();
