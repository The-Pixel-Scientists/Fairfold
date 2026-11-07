// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building and publishing forms (ADR 0004, ADR 0036), for staff in the
// console. The draft, preview and publish routes take the same shapes as
// grants' form versions, so the shared builder talks to both the same way.
//
// - `forms.forms.manage` lists, creates (`forms.form.created`), reads and
//   changes forms (`forms.form.updated`), and reads and saves the draft
//   (`forms.form_draft.saved`). Settings are configuration (rule 10): each
//   change writes `config_version` as `forms.form`, with config.ts's diff.
// - `forms.retention.manage`, with step-up, changes how long responses are
//   kept (`forms.form.retention_changed`). A new form keeps them for
//   DEFAULT_RETENTION_MONTHS; one anyone can answer, for at most
//   ANONYMOUS_RETENTION_MONTHS (ADR 0027), which the server checks on both
//   routes against the stored values.
// - `forms.forms.publish` publishes the draft as an immutable version with a
//   number the server sets (`forms.form_version.published`), recording the
//   form's respondents setting on it. The server refuses the publication
//   with publishProblems(), by field id only, against every earlier version.
//   No route changes or removes a published version.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  changedFieldTypes,
  fieldIdSchema,
  formDefinitionSchema,
  loweredClassifications,
  questionsOf,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';
import { catalogueParams, type FieldProblem } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { formsMessages as m, says } from './messages.ts';
import {
  choice,
  classified,
  cursorSchema,
  formStatuses,
  HIDDEN,
  HIDDEN_IN_TEXT,
  line,
  paragraphs,
  respondentOptions,
  timestampSchema,
  type Respondents,
} from './schemas.ts';

export const RETENTION_MONTHS = { min: 1, max: 120 } as const;
export const DEFAULT_RETENTION_MONTHS = 12;
/** The cap for a form with no known subject, which anonymous responses are (ADR 0027, ADR 0036). */
export const ANONYMOUS_RETENTION_MONTHS = 12;

/** The largest definition: 256 KB, as the UTF-8 bytes of its compact JSON once parsed. */
export const FORM_DEFINITION_MAX_BYTES = 256 * 1024;

const settingsShape = {
  title: line(200, m.title),
  description: paragraphs(2000),
  respondents: choice(respondentOptions, m.respondents),
  opensAt: timestampSchema.nullable(),
  closesAt: timestampSchema.nullable(),
  confirmationMessage: paragraphs(2000),
};

/** A form's settings, all replaced at once. Empty text means none. */
export const formSettingsInputSchema = z
  .strictObject(settingsShape)
  .refine(
    ({ opensAt, closesAt }) =>
      opensAt === null || closesAt === null || Date.parse(closesAt) > Date.parse(opensAt),
    { ...says(m.closesAfterOpens), path: ['closesAt'] },
  );

export type FormSettingsInput = z.infer<typeof formSettingsInputSchema>;

export const retentionInputSchema = z.strictObject({
  retentionMonths: z.int().min(RETENTION_MONTHS.min).max(RETENTION_MONTHS.max),
});

const LINE_KEYS = new Set(['title', 'label', 'rowNoun']);
const TEXT_KEYS = new Set(['introduction', 'hint', 'body', 'explanation']);

type Path = (string | number)[];

/** A copy of a definition with each text value replaced by what `visit` gives back. */
function mapTexts(
  value: unknown,
  path: Path,
  visit: (text: string, oneLine: boolean, path: Path) => string,
): unknown {
  if (Array.isArray(value)) return value.map((item, i) => mapTexts(item, [...path, i], visit));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const at = [...path, key];
      const oneLine = LINE_KEYS.has(key);
      return typeof item === 'string' && (oneLine || TEXT_KEYS.has(key))
        ? [key, visit(item, oneLine, at)]
        : [key, mapTexts(item, at, visit)];
    }),
  );
}

function textMessage(text: string, oneLine: boolean): string | undefined {
  if (oneLine && HIDDEN.test(text)) return m.hiddenCharacters;
  if (!oneLine && HIDDEN_IN_TEXT.test(text)) return m.hiddenCharactersText;
  return text === '' ? m.blank : undefined;
}

/** A definition the form engine accepts (rules and definitionProblems()), with tidy text, within the size limit. */
export const formDefinitionInputSchema = formDefinitionSchema
  .overwrite(
    (definition) =>
      mapTexts(definition, [], (text, oneLine) =>
        (oneLine ? text : text.replace(/\r\n?/g, '\n')).trim(),
      ) as FormDefinition,
  )
  .superRefine((definition, context) => {
    mapTexts(definition, [], (text, oneLine, path) => {
      const message = textMessage(text, oneLine);
      if (message !== undefined) {
        context.addIssue({ code: 'custom', path, message, params: catalogueParams });
      }
      return text;
    });
  })
  .refine(
    (definition) =>
      new TextEncoder().encode(JSON.stringify(definition)).length <= FORM_DEFINITION_MAX_BYTES,
    says(m.definitionTooLarge),
  );

/** Saving the draft replaces its whole definition. Field ids come from the builder, never from staff. */
export const formDraftInputSchema = z.strictObject({ definition: formDefinitionInputSchema });

/**
 * Why a draft cannot be published, by field id (`f_…`, or `f_….c_…` for a
 * table column), against every earlier published version: an id that
 * changed type or was classified lower, and, for a form anyone can answer, a
 * file or aggregate-only question (ADR 0036).
 */
export function publishProblems(
  earlier: readonly FormDefinition[],
  next: FormDefinition,
  respondents: Respondents,
): FieldProblem[] {
  const problems: FieldProblem[] = [
    ...changedFieldTypes(earlier, next).map((field) => ({ field, message: m.typeChanged })),
    ...loweredClassifications(earlier, next).map((field) => ({
      field,
      message: m.classificationLowered,
    })),
  ];
  if (respondents === 'signed_in') return problems;
  for (const question of questionsOf(next)) {
    if (question.type === 'file') problems.push({ field: question.id, message: m.anonymousFile });
    else if (question.audiences === 'aggregate_only') {
      problems.push({ field: question.id, message: m.anonymousAggregate });
    }
  }
  return problems;
}

const formShape = {
  id: idSchema,
  title: z.string(),
  description: z.string(),
  respondents: z.enum(respondentOptions),
  opensAt: timestampSchema.nullable(),
  closesAt: timestampSchema.nullable(),
  retentionMonths: z.int(),
  confirmationMessage: z.string(),
  status: z.enum(formStatuses),
  /** The latest published version's number, from 1; null for a draft. */
  latestVersion: z.int().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const formSchema = classified(z.strictObject(formShape), {
  id: 'internal',
  title: 'internal',
  description: 'internal',
  respondents: 'internal',
  opensAt: 'internal',
  closesAt: 'internal',
  retentionMonths: 'internal',
  confirmationMessage: 'internal',
  status: 'internal',
  latestVersion: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
});

export type Form = z.infer<typeof formSchema>;

const formSummarySchema = classified(
  z.strictObject({
    id: formShape.id,
    title: formShape.title,
    respondents: formShape.respondents,
    opensAt: formShape.opensAt,
    closesAt: formShape.closesAt,
    status: formShape.status,
    latestVersion: formShape.latestVersion,
    updatedAt: formShape.updatedAt,
  }),
  {
    id: 'internal',
    title: 'internal',
    respondents: 'internal',
    opensAt: 'internal',
    closesAt: 'internal',
    status: 'internal',
    latestVersion: 'internal',
    updatedAt: 'internal',
  },
);

/** The most recently changed first. */
export const formPageSchema = classified(
  z.strictObject({ forms: z.array(formSummarySchema), nextCursor: cursorSchema.nullable() }),
  { forms: 'internal', nextCursor: 'internal' },
);

export const formQuerySchema = z.strictObject({
  status: z.enum(formStatuses).optional(),
  cursor: cursorSchema.optional(),
});

/** The draft's definition, null until it is first saved. */
export const formDraftSchema = classified(
  z.strictObject({
    formId: idSchema,
    definition: formDefinitionSchema.nullable(),
    updatedAt: timestampSchema,
  }),
  { formId: 'internal', definition: 'internal', updatedAt: 'internal' },
);

/** Who a preview shows the draft to: anyone who answers, signed in or not, or staff reading responses. */
export const previewAudiences = ['respondent', 'staff'] as const;

export const previewQuerySchema = z.strictObject({
  audience: choice(previewAudiences, m.previewAudience),
});

/** The draft, and the ids of the fields `canSee()` shows the audience. Nothing is stored. */
export const formPreviewSchema = classified(
  z.strictObject({ definition: formDefinitionSchema, visibleFieldIds: z.array(fieldIdSchema) }),
  { definition: 'internal', visibleFieldIds: 'internal' },
);

const versionSummaryShape = {
  id: idSchema,
  /** Counts from 1 in the form, set by the server. */
  version: z.int(),
  /** The form's respondents setting when this version was published, fixed with it (ADR 0036). */
  respondents: z.enum(respondentOptions),
  publishedAt: timestampSchema,
};

const versionSummarySchema = classified(z.strictObject(versionSummaryShape), {
  id: 'internal',
  version: 'internal',
  respondents: 'internal',
  publishedAt: 'internal',
});

/** The newest first. */
export const formVersionListSchema = classified(
  z.strictObject({ versions: z.array(versionSummarySchema) }),
  { versions: 'internal' },
);

export const formVersionSchema = classified(
  z.strictObject({ ...versionSummaryShape, formId: idSchema, definition: formDefinitionSchema }),
  {
    id: 'internal',
    version: 'internal',
    respondents: 'internal',
    publishedAt: 'internal',
    formId: 'internal',
    definition: 'internal',
  },
);

export type FormVersion = z.infer<typeof formVersionSchema>;

const staff = { audience: 'console', module: 'forms', scope: 'tenant' } as const;
const manage = { ...staff, permission: 'forms.forms.manage' } as const;
const form = { params: z.strictObject({ formId: idSchema }) } as const;

export const listForms = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/forms',
  summary: 'List forms, the most recently changed first, a page at a time',
  query: formQuerySchema,
  responses: { 200: formPageSchema },
});

export const createForm = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/forms',
  summary: 'Create a form with an empty draft',
  body: formSettingsInputSchema,
  responses: { 201: formSchema },
});

export const getForm = defineRoute({
  ...manage,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId',
  summary: "Read a form's settings",
  responses: { 200: formSchema },
});

export const updateFormSettings = defineRoute({
  ...manage,
  ...form,
  method: 'PUT',
  path: '/console/forms/:formId/settings',
  summary: "Replace a form's settings, recording a configuration version",
  body: formSettingsInputSchema,
  responses: { 200: formSchema },
});

export const updateFormRetention = defineRoute({
  ...staff,
  ...form,
  permission: 'forms.retention.manage',
  stepUp: true,
  method: 'PUT',
  path: '/console/forms/:formId/retention',
  summary: "Change how many months a form's responses are kept",
  body: retentionInputSchema,
  responses: { 200: formSchema },
});

export const getFormDraft = defineRoute({
  ...manage,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId/draft',
  summary: "Read a form's draft definition",
  responses: { 200: formDraftSchema },
});

export const saveFormDraft = defineRoute({
  ...manage,
  ...form,
  method: 'PUT',
  path: '/console/forms/:formId/draft',
  summary: "Replace a form's draft definition, checked by the form engine",
  body: formDraftInputSchema,
  responses: { 200: formDraftSchema },
});

export const previewFormDraft = defineRoute({
  ...manage,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId/preview',
  summary: "Show a form's draft as a respondent or staff would see it, storing nothing",
  query: previewQuerySchema,
  responses: { 200: formPreviewSchema },
});

export const listFormVersions = defineRoute({
  ...manage,
  ...form,
  method: 'GET',
  path: '/console/forms/:formId/versions',
  summary: "List a form's published versions, the newest first",
  responses: { 200: formVersionListSchema },
});

export const getFormVersion = defineRoute({
  ...manage,
  params: z.strictObject({ formId: idSchema, formVersionId: idSchema }),
  method: 'GET',
  path: '/console/forms/:formId/versions/:formVersionId',
  summary: 'Read a published version with its definition',
  responses: { 200: formVersionSchema },
});

export const publishForm = defineRoute({
  ...staff,
  ...form,
  permission: 'forms.forms.publish',
  method: 'POST',
  idempotent: true,
  path: '/console/forms/:formId/versions',
  summary: "Publish a form's draft as a fixed version, refused by field id if it breaks a rule",
  responses: { 201: formVersionSchema },
});

export const formRoutes = {
  listForms,
  createForm,
  getForm,
  updateFormSettings,
  updateFormRetention,
  getFormDraft,
  saveFormDraft,
  previewFormDraft,
  listFormVersions,
  getFormVersion,
  publishForm,
} as const;
