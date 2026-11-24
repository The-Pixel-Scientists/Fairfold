// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the staff handlers read from the platform (ADR 0016). The module never
// imports from the API or the database package: the API passes in a store
// bound to the request's transaction, and the problems it sends. Nothing here
// takes a tenant id, and the acting member comes only from the context.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import type { FieldProblem } from '@pixel-scientists/domain/platform';
import type { ConfigDiff } from '@pixel-scientists/domain/platform/settings';

import type { FormSettingsInput, FormsAuditAction, Respondents } from '../../contracts/index.ts';

/** A form as stored, with its latest published version's number. */
export interface FormRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly respondents: Respondents;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
  readonly retentionMonths: number;
  readonly confirmationMessage: string;
  readonly latestVersion: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The form's one draft. Its definition is null until it is first saved. */
export interface DraftRow {
  readonly id: string;
  readonly version: number;
  readonly definition: unknown;
  readonly updatedAt: Date;
}

export interface VersionRow {
  readonly id: string;
  readonly formId: string;
  readonly version: number;
  readonly respondents: Respondents;
  readonly definition: unknown;
  readonly publishedAt: Date;
}

/** Where a page of forms starts: just after this form in the list's order. */
export interface After {
  readonly updatedAt: Date;
  readonly id: string;
}

/**
 * The staff routes' reads and writes, bound to one request's transaction and
 * tenant. Every method reads and writes only the caller's tenant, and a row
 * of another tenant is not there. Ids and times that a row records come from
 * the database.
 */
export interface StaffStore {
  /** The most recently changed first, `limit` of them. */
  list(query: {
    status: 'draft' | 'published' | undefined;
    after: After | null;
    limit: number;
  }): Promise<FormRow[]>;
  /** The form, locked until the request ends when asked. */
  find(formId: string, lock?: boolean): Promise<FormRow | undefined>;
  /** Adds a form with its first draft, which holds `definition` or nothing. */
  insert(
    settings: FormSettingsInput,
    definition: FormDefinition | null,
    actor: string,
  ): Promise<string>;
  updateSettings(formId: string, settings: FormSettingsInput, actor: string): Promise<void>;
  updateRetention(formId: string, months: number, actor: string): Promise<void>;
  draft(formId: string): Promise<DraftRow | undefined>;
  /** Starts the next draft, after the latest published version. */
  insertDraft(
    formId: string,
    version: number,
    definition: FormDefinition,
    actor: string,
  ): Promise<DraftRow>;
  saveDraft(draftId: string, definition: FormDefinition, actor: string): Promise<DraftRow>;
  /** The published versions' respondents and definitions, the oldest first. */
  published(formId: string): Promise<Pick<VersionRow, 'respondents' | 'definition'>[]>;
  /** The published versions without their definitions, the newest first. */
  versions(formId: string): Promise<Omit<VersionRow, 'definition'>[]>;
  version(formId: string, versionId: string): Promise<VersionRow | undefined>;
  /** The id of the form's latest configuration version. */
  latestConfigVersion(formId: string): Promise<string>;
  /** Turns the draft into a published version, which the database then holds fixed. */
  publish(
    draftId: string,
    definition: FormDefinition,
    configVersionId: string,
    actor: string,
  ): Promise<void>;
}

export interface StaffDependencies<Tx> {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A request the caller can fix or retry, in words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  readonly store: (tx: Tx) => StaffStore;
}

/** What a handler reads from the request context. */
export interface StaffContext {
  readonly audit: {
    record(event: {
      readonly action: FormsAuditAction;
      readonly entityId: string;
      readonly changes?: Readonly<Record<string, { before?: unknown; after?: unknown }>>;
    }): Promise<void>;
  };
  /** Writes the form's next configuration version (rule 10) in the request's transaction. */
  readonly config: {
    record(
      entityType: 'forms.form',
      entityId: string,
      diff: ConfigDiff<'forms.form'>,
    ): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

export interface Args<Tx, I> {
  readonly tx: Tx;
  readonly context: StaffContext;
  readonly input: I;
}

export interface FormParams {
  readonly params: { readonly formId: string };
}

export const staffRefusals = {
  cursor: 'This page of forms is not available. Go back to the first page.',
  noDraft: 'This form has no changes to publish. Edit the draft, then publish it.',
  nothingSaved:
    'This draft has no questions yet. Add a section with a question, save, then publish.',
  nothingToPreview: 'This form has no saved draft yet. Save the draft, then preview it.',
} as const;
