// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form routes' handlers: list, create, read, and change settings and
// retention. The platform has already checked the session, the permission and
// that forms is on. Every change to a form's settings writes its
// configuration version (rule 10) and its audit event in the request's
// transaction, and a save that changes nothing writes neither. A change takes
// the form's row lock first, so two changes to one form never interleave.
// Audit events name the settings that changed and keep the values only of
// those that are not text someone typed.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import type { ConfigDiff } from '@pixel-scientists/domain/platform/settings';

import {
  ANONYMOUS_RETENTION_MONTHS,
  formsMessages,
  type Form,
  type FormSettingsInput,
} from '../../contracts/index.ts';
import { idSchema } from '../../contracts/schemas.ts';
import {
  staffRefusals,
  type After,
  type Args,
  type FormParams,
  type FormRow,
  type StaffDependencies,
  type StaffStore,
} from './context.ts';

type Change = ConfigDiff<'forms.form'>[number];
type Field = Change['field'];

const PAGE_SIZE = 50;

/** The settings of a form that has none yet, so that its first diff lists every one it sets. */
const BLANK: FormSettingsInput = {
  title: '',
  description: '',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  confirmationMessage: '',
};

const COLUMNS: Readonly<Record<Field, string>> = {
  title: 'forms.form.title',
  description: 'forms.form.description',
  respondents: 'forms.form.respondents',
  opensAt: 'forms.form.opens_at',
  closesAt: 'forms.form.closes_at',
  confirmationMessage: 'forms.form.confirmation_message',
  retentionMonths: 'forms.form.retention_months',
};

/** Text a person typed: its change is named in the audit log, and its values are in the configuration version. */
const TYPED: ReadonlySet<Field> = new Set(['title', 'description', 'confirmationMessage']);

const iso = (time: Date | null): string | null => (time === null ? null : time.toISOString());

export function toForm(row: FormRow): Form {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    respondents: row.respondents,
    opensAt: iso(row.opensAt),
    closesAt: iso(row.closesAt),
    retentionMonths: row.retentionMonths,
    confirmationMessage: row.confirmationMessage,
    status: row.latestVersion === null ? 'draft' : 'published',
    latestVersion: row.latestVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSummary(row: FormRow) {
  const { id, title, respondents, opensAt, closesAt, status, latestVersion, updatedAt } =
    toForm(row);
  return { id, title, respondents, opensAt, closesAt, status, latestVersion, updatedAt };
}

export function settingsOf(row: FormRow): FormSettingsInput {
  return {
    title: row.title,
    description: row.description ?? '',
    respondents: row.respondents,
    opensAt: iso(row.opensAt),
    closesAt: iso(row.closesAt),
    confirmationMessage: row.confirmationMessage,
  };
}

const SETTINGS = [
  'title',
  'description',
  'respondents',
  'opensAt',
  'closesAt',
  'confirmationMessage',
] as const;

/** What changed between two settings, as the configuration version records it. */
export function settingsDiff(before: FormSettingsInput, after: FormSettingsInput): Change[] {
  return SETTINGS.flatMap((field) => {
    const [from, to] = [before[field], after[field]];
    if (from === to) return [];
    const empty = field === 'description';
    return [
      { field, from: empty && from === '' ? null : from, to: empty && to === '' ? null : to },
    ] as Change[];
  });
}

/** The audit event's changes for a diff: values only where they are not typed text. */
export function auditChanges(diff: readonly Change[]) {
  return Object.fromEntries(
    diff.map(({ field, from, to }) => [
      COLUMNS[field],
      TYPED.has(field) ? {} : { before: from, after: to },
    ]),
  );
}

export function encodeCursor({ updatedAt, id }: After): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');
}

/** Where a page's cursor says to start, or undefined if it is not one this server made. */
export function decodeCursor(cursor: string): After | undefined {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString().split('|');
  const updatedAt = new Date(at ?? '');
  const found = idSchema.safeParse(id);
  if (rest.length > 0 || Number.isNaN(updatedAt.getTime()) || !found.success) return undefined;
  return updatedAt.toISOString() === at ? { updatedAt, id: found.data } : undefined;
}

/** What the form, version and template handlers share: reading a form, and making one. */
export function formCore<Tx>(deps: StaffDependencies<Tx>) {
  async function read(store: StaffStore, formId: string, lock = false): Promise<FormRow> {
    return (await store.find(formId, lock)) ?? Promise.reject(deps.notFound());
  }

  /** Adds a form with its first draft, its configuration version and its audit event. */
  async function makeForm(
    { tx, context }: Pick<Args<Tx, unknown>, 'tx' | 'context'>,
    settings: FormSettingsInput,
    definition: FormDefinition | null,
  ): Promise<Form> {
    const store = deps.store(tx);
    const id = await store.insert(settings, definition, context.membership.id);
    const diff = settingsDiff(BLANK, settings);
    await context.config.record('forms.form', id, diff);
    await context.audit.record({
      action: 'forms.form.created',
      entityId: id,
      changes: auditChanges(diff),
    });
    return toForm(await read(store, id));
  }

  return { read, makeForm };
}

export function formHandlers<Tx>(deps: StaffDependencies<Tx>) {
  const { read, makeForm } = formCore(deps);
  const anonymousRetention = (field: string) =>
    deps.refuse(400, formsMessages.anonymousRetention, [
      { field, message: formsMessages.anonymousRetention },
    ]);

  async function listForms({
    tx,
    input,
  }: Args<Tx, { query: { status?: 'draft' | 'published'; cursor?: string } }>) {
    const { status, cursor } = input.query;
    const after = cursor === undefined ? null : decodeCursor(cursor);
    if (after === undefined) throw deps.refuse(400, staffRefusals.cursor);
    const rows = await deps.store(tx).list({ status, after, limit: PAGE_SIZE + 1 });
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      forms: page.map(toSummary),
      nextCursor: rows.length > PAGE_SIZE && last !== undefined ? encodeCursor(last) : null,
    };
  }

  const createForm = ({ tx, context, input }: Args<Tx, { body: FormSettingsInput }>) =>
    makeForm({ tx, context }, input.body, null);

  async function getForm({ tx, input }: Args<Tx, FormParams>): Promise<Form> {
    return toForm(await read(deps.store(tx), input.params.formId));
  }

  async function updateFormSettings({
    tx,
    context,
    input,
  }: Args<Tx, FormParams & { body: FormSettingsInput }>): Promise<Form> {
    const { formId } = input.params;
    const store = deps.store(tx);
    const found = await read(store, formId, true);
    const diff = settingsDiff(settingsOf(found), input.body);
    if (diff.length === 0) return toForm(found);
    if (
      input.body.respondents !== 'signed_in' &&
      found.retentionMonths > ANONYMOUS_RETENTION_MONTHS
    ) {
      throw anonymousRetention('body.respondents');
    }
    await store.updateSettings(formId, input.body, context.membership.id);
    await context.config.record('forms.form', formId, diff);
    await context.audit.record({
      action: 'forms.form.updated',
      entityId: formId,
      changes: auditChanges(diff),
    });
    return toForm(await read(store, formId));
  }

  async function updateFormRetention({
    tx,
    context,
    input,
  }: Args<Tx, FormParams & { body: { retentionMonths: number } }>): Promise<Form> {
    const { formId } = input.params;
    const { retentionMonths } = input.body;
    const store = deps.store(tx);
    const found = await read(store, formId, true);
    if (found.retentionMonths === retentionMonths) return toForm(found);
    if (found.respondents !== 'signed_in' && retentionMonths > ANONYMOUS_RETENTION_MONTHS) {
      throw anonymousRetention('body.retentionMonths');
    }
    await store.updateRetention(formId, retentionMonths, context.membership.id);
    const diff: Change[] = [
      { field: 'retentionMonths', from: found.retentionMonths, to: retentionMonths },
    ];
    await context.config.record('forms.form', formId, diff);
    await context.audit.record({
      action: 'forms.form.retention_changed',
      entityId: formId,
      changes: auditChanges(diff),
    });
    return toForm(await read(store, formId));
  }

  return { listForms, createForm, getForm, updateFormSettings, updateFormRetention };
}
