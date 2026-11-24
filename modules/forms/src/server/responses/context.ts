// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the response handlers read from the platform (ADR 0016). The module
// never imports from the API or the database package: the API passes in a
// store bound to the request's transaction, and the problems it sends.
// Nothing here takes a tenant id, and the acting member or person always
// comes from the context, never from a request.

import type { AuditAction, FieldProblem } from '@pixel-scientists/domain/platform';

import type { FormsAuditAction, ResponseRoute, SpamReason } from '../../contracts/index.ts';

/** A submitted response without its answers. */
export interface SummaryRow {
  readonly id: string;
  readonly formId: string;
  readonly formVersionId: string;
  readonly version: number;
  readonly route: ResponseRoute;
  readonly personId: string | null;
  readonly submittedAt: Date;
  /** An anonymous response stored with no proof. */
  readonly sentWithoutCheck: boolean;
  readonly spamReason: SpamReason | null;
}

/** A submitted response with the pinned version's definition and the answers as stored. */
export interface DetailRow extends SummaryRow {
  readonly definition: unknown;
  readonly answers: unknown;
}

export interface Filters {
  readonly formVersionId?: string;
  readonly submittedFrom?: Date;
  readonly submittedTo?: Date;
  readonly route?: ResponseRoute;
}

export interface Totals {
  readonly received: number;
  readonly signedIn: number;
  readonly anonymous: number;
  readonly sentWithoutCheck: number;
  readonly spam: number;
}

/** Where a page starts: just after this response in the list's order. */
export interface After {
  readonly submittedAt: Date;
  readonly id: string;
}

/** A form a signed-in person may answer now, with the version they would answer. */
export interface OpenForm {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly closesAt: Date | null;
  readonly confirmationMessage: string;
  readonly formVersionId: string;
  readonly definition: unknown;
}

export interface SignedInVersion {
  readonly id: string;
  readonly definition: unknown;
}

export interface DraftRow {
  readonly formVersionId: string;
  readonly definition: unknown;
  readonly answers: unknown;
  readonly updatedAt: Date;
}

export interface OwnSummary {
  readonly id: string;
  readonly formId: string;
  readonly formTitle: string;
  readonly submittedAt: Date;
}

export interface OwnDetail extends OwnSummary {
  readonly formVersionId: string;
  readonly definition: unknown;
  readonly answers: unknown;
}

export interface Receipt {
  readonly responseId: string;
  readonly submittedAt: Date;
  readonly confirmationMessage: string;
}

/**
 * The response routes' reads and writes, bound to one request's transaction
 * and tenant. Every method reads and writes only the caller's tenant, so a
 * row of another tenant is not there. A person's methods take the person the
 * handler found from the session. Ids and times that a row records come from
 * the database, and only submitted responses are ever returned to staff.
 */
export interface ResponseStore {
  formExists(formId: string): Promise<boolean>;
  /** Newest first, `limit` of them; `view` is which of the form's responses to show. */
  list(
    formId: string,
    view: 'received' | 'without_check' | 'spam',
    filters: Filters,
    after: After | null,
    limit: number,
  ): Promise<SummaryRow[]>;
  totals(formId: string, filters: Filters): Promise<Totals>;
  find(responseId: string, lock?: boolean): Promise<DetailRow | undefined>;
  /** The submitted anonymous response whose token's keyed hash this is, if the token is live. */
  findByToken(tokenHash: Buffer): Promise<DetailRow | undefined>;
  /** Sets or clears the spam mark, by `actor`'s membership. */
  setSpam(responseId: string, reason: SpamReason | null, actor: string): Promise<void>;

  /** The person this account is, if it has one here. */
  personFor(userId: string): Promise<string | null>;
  openForm(formId: string): Promise<OpenForm | undefined>;
  /** The version, if it is a published version of the form taking signed-in answers. */
  signedInVersion(formId: string, versionId: string): Promise<SignedInVersion | undefined>;
  draft(formId: string, personId: string): Promise<DraftRow | undefined>;
  /** The person's one draft of the form, made or moved to the version. */
  saveDraft(
    formId: string,
    personId: string,
    versionId: string,
    answers: unknown,
    actor: string,
  ): Promise<DraftRow>;
  /** Makes the person's draft, or a new row, a submitted response pinned to the version. */
  submit(
    formId: string,
    personId: string,
    versionId: string,
    answers: unknown,
    actor: string,
  ): Promise<string>;
  receipt(responseId: string, personId: string): Promise<Receipt | undefined>;
  own(personId: string, after: After | null, limit: number): Promise<OwnSummary[]>;
  ownOne(responseId: string, personId: string): Promise<OwnDetail | undefined>;
}

export interface ResponseDependencies<Tx> {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A request the caller can fix or retry, in words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  /** The form-changed problem (409), for a version that is not one the form takes. */
  readonly formChanged: () => Error;
  readonly store: (tx: Tx) => ResponseStore;
  /** The key that hashes respondent tokens: the one the public routes used to store them. */
  readonly hashKey: Uint8Array | undefined;
  /** The person for an account, made from its own details if there is none; `created` tells the handler to audit it. */
  readonly ensurePerson: (
    tx: Tx,
    account: { readonly userId: string; readonly email: string },
  ) => Promise<{ readonly personId: string; readonly created: boolean }>;
}

/** What a handler reads from the request context. */
export interface ResponseContext {
  readonly audit: {
    record(event: {
      readonly action: FormsAuditAction | AuditAction;
      readonly entityId: string;
      readonly changes?: Readonly<Record<string, { before?: unknown; after?: unknown }>>;
      readonly subjectPartyId?: string;
    }): Promise<void>;
    read(entity: {
      readonly action: FormsAuditAction;
      readonly entityId: string;
      readonly subjectPartyId?: string;
    }): Promise<void>;
  };
  readonly membership: { readonly id: string };
  readonly session: { readonly userId: string; readonly email: () => Promise<string> };
}

export interface Args<Tx, I> {
  readonly tx: Tx;
  readonly context: ResponseContext;
  readonly input: I;
}

export const responseRefusals = {
  cursor: 'This page of responses is not available. Go back to the first page.',
  noFiles: 'Files cannot be attached to this form yet. Remove the answer to this question.',
} as const;
