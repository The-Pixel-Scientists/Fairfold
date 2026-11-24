// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The draft, preview and version routes' handlers (rule 7, rule 10). A form
// has at most one draft; only a draft changes. Publishing turns it into the
// next numbered version, which the database then holds fixed: no handler
// updates or deletes a published version. Every request that changes the
// draft takes the form's row lock first, so a save is never lost under a
// publication that read the draft before it, and a second publish of the same
// draft finds none and is refused. An audit event holds ids and numbers, never
// the definition.

import {
  canSee,
  fieldsOf,
  type FormDefinition,
  type ProjectionAudience,
} from '@pixel-scientists/domain/forms';
import {
  fieldForIssue,
  messageForIssue,
  messages,
  type FieldProblem,
} from '@pixel-scientists/domain/platform';

import {
  formDefinitionInputSchema,
  publishProblems,
  type FormVersion,
} from '../../contracts/index.ts';
import {
  staffRefusals,
  type Args,
  type FormParams,
  type StaffDependencies,
  type StaffStore,
} from './context.ts';
import { formCore } from './forms.ts';

const AUDIENCES: Readonly<Record<'respondent' | 'staff', ProjectionAudience>> = {
  respondent: 'respondent',
  staff: 'staff',
};

const iso = (time: Date): string => time.toISOString();

export function versionHandlers<Tx>(deps: StaffDependencies<Tx>) {
  const { read } = formCore(deps);

  /** A stored definition checked again by the form engine and the contract's text rules. */
  function recheck(stored: unknown): FormDefinition {
    const parsed = formDefinitionInputSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    throw deps.refuse(
      400,
      messages.fixFields,
      parsed.error.issues.map((issue): FieldProblem => ({
        field: fieldForIssue('definition', issue),
        message: messageForIssue(issue),
      })),
    );
  }

  /** The draft, or the latest published definition a new draft would start from. */
  async function current(store: StaffStore, formId: string) {
    const draft = await store.draft(formId);
    if (draft !== undefined) return { definition: draft.definition, updatedAt: draft.updatedAt };
    const latest = (await store.published(formId)).at(-1);
    return { definition: latest?.definition ?? null, updatedAt: null };
  }

  async function getFormDraft({ tx, input }: Args<Tx, FormParams>) {
    const { formId } = input.params;
    const store = deps.store(tx);
    const form = await read(store, formId);
    const { definition, updatedAt } = await current(store, formId);
    return {
      formId,
      definition: definition as FormDefinition | null,
      updatedAt: iso(updatedAt ?? form.updatedAt),
    };
  }

  async function saveFormDraft({
    tx,
    context,
    input,
  }: Args<Tx, FormParams & { body: { definition: FormDefinition } }>) {
    const { formId } = input.params;
    const { definition } = input.body;
    const store = deps.store(tx);
    const form = await read(store, formId, true);
    const actor = context.membership.id;
    const found = await store.draft(formId);
    const draft =
      found === undefined
        ? await store.insertDraft(formId, (form.latestVersion ?? 0) + 1, definition, actor)
        : await store.saveDraft(found.id, definition, actor);
    await context.audit.record({
      action: 'forms.form_draft.saved',
      entityId: draft.id,
      changes: { 'forms.form_version.definition': {} },
    });
    return { formId, definition, updatedAt: iso(draft.updatedAt) };
  }

  async function previewFormDraft({
    tx,
    input,
  }: Args<Tx, FormParams & { query: { audience: 'respondent' | 'staff' } }>) {
    const { formId } = input.params;
    const store = deps.store(tx);
    await read(store, formId);
    const { definition: stored } = await current(store, formId);
    if (stored === null) throw deps.refuse(409, staffRefusals.nothingToPreview);
    const definition = stored as FormDefinition;
    const audience = AUDIENCES[input.query.audience];
    return {
      definition,
      visibleFieldIds: fieldsOf(definition)
        .filter((field) => canSee(field, audience))
        .map((field) => field.id),
    };
  }

  async function listFormVersions({ tx, input }: Args<Tx, FormParams>) {
    const { formId } = input.params;
    const store = deps.store(tx);
    await read(store, formId);
    const versions = await store.versions(formId);
    return {
      versions: versions.map(({ id, version, respondents, publishedAt }) => ({
        id,
        version,
        respondents,
        publishedAt: iso(publishedAt),
      })),
    };
  }

  async function getFormVersion({
    tx,
    input,
  }: Args<Tx, { params: { formId: string; formVersionId: string } }>): Promise<FormVersion> {
    const { formId, formVersionId } = input.params;
    const found = await deps.store(tx).version(formId, formVersionId);
    if (found === undefined) throw deps.notFound();
    return {
      id: found.id,
      version: found.version,
      respondents: found.respondents,
      publishedAt: iso(found.publishedAt),
      formId: found.formId,
      definition: found.definition as FormDefinition,
    };
  }

  async function publishForm({ tx, context, input }: Args<Tx, FormParams>): Promise<FormVersion> {
    const { formId } = input.params;
    const store = deps.store(tx);
    const form = await read(store, formId, true);
    const draft = await store.draft(formId);
    if (draft === undefined) throw deps.refuse(409, staffRefusals.noDraft);
    if (draft.definition === null) throw deps.refuse(409, staffRefusals.nothingSaved);

    const definition = recheck(draft.definition);
    const earlier = await store.published(formId);
    const problems = publishProblems(
      earlier.map((version) => version.definition as FormDefinition),
      definition,
      form.respondents,
    );
    if (problems.length > 0) throw deps.refuse(400, messages.fixFields, problems);

    const actor = context.membership.id;
    const before = earlier.at(-1)?.respondents ?? form.respondents;
    await context.config.record('forms.form', formId, [
      { field: 'respondents', from: before, to: form.respondents },
    ]);
    await store.publish(draft.id, definition, await store.latestConfigVersion(formId), actor);
    await context.audit.record({
      action: 'forms.form_version.published',
      entityId: draft.id,
      changes: {
        'forms.form_version.version': { before: null, after: draft.version },
        'forms.form_version.status': { before: 'draft', after: 'published' },
        'forms.form_version.respondents': { before: null, after: form.respondents },
      },
    });
    return getFormVersion({ tx, context, input: { params: { formId, formVersionId: draft.id } } });
  }

  return {
    getFormDraft,
    saveFormDraft,
    previewFormDraft,
    listFormVersions,
    getFormVersion,
    publishForm,
  };
}
