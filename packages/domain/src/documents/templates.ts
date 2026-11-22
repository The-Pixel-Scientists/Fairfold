// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document templates (ADR 0040). A template is configuration (rule 10): each
// publish writes an immutable `app.document_template_version` row and a
// `config_version` row with its author and diff, and every generated
// document pins the version it used. S12-62 adds the table with
// `tenant_id`, row-level security, a cross-tenant denial test and its
// columns classified, kept for the life of the tenant.
//
// The body is structured data, never code or HTML: a closed set of blocks
// whose text is plain and whose merge fields name stable field ids. A value
// is set as text and never interpreted, so it cannot change the layout, add
// a link or fetch anything.
//
// Each template has an audience, and a merge field reaches a document only
// if that audience may see it through the same canSee() as the audience
// projection, so blind review holds in documents too.

import { z } from 'zod';

import { canSee, projectionAudiences, type ProjectionAudience } from '../forms/audience.ts';
import { classificationOf } from '../forms/classification.ts';
import { fieldIdSchema, fieldsOf, type FormField } from '../forms/definition.ts';
import { projectAnswers } from '../forms/project.ts';
import type { FormDefinition } from '../forms/rules.ts';
import type { Answers } from '../forms/visibility.ts';
import { idSchema } from '../id.ts';
import { catalogueParams } from '../platform/messages.ts';
import { documentsMessages } from './messages.ts';

/** What a template makes. Board packs (staff) now; agreements (applicant) in wave 2. */
export const documentKinds = ['board_pack', 'agreement'] as const;

export type DocumentKind = (typeof documentKinds)[number];

/** Why the worker made no document, stored as `document.<code>`. */
export const documentFailures = ['too_large', 'field_not_released'] as const;

export type DocumentFailure = (typeof documentFailures)[number];

export const MAX_MERGE_FIELDS = 200;
export const MAX_TEMPLATE_BLOCKS = 500;
/** The body as JSON, in characters. */
export const MAX_TEMPLATE_BODY_LENGTH = 200_000;
/** The most records one document is made from. */
export const MAX_DOCUMENT_SUBJECTS = 50;

const says = (error: string) => ({ error, params: catalogueParams });

/** One line of plain text: no control or format characters, so nothing hides or reorders. */
const text = z
  .string()
  .min(1)
  .max(2000)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, says(documentsMessages.plainText));

/** Text and merge fields, in reading order. */
const line = z
  .array(z.union([z.strictObject({ text }), z.strictObject({ field: fieldIdSchema })]))
  .min(1)
  .max(100);

const table = z
  .strictObject({
    type: z.literal('table'),
    header: z.array(text).min(1).max(10),
    rows: z.array(z.array(line).min(1).max(10)).min(1).max(200),
  })
  .refine(
    ({ header, rows }) => rows.every((row) => row.length === header.length),
    says(documentsMessages.tableColumns),
  );

/** The blocks a body is made of; the renderer maps each kind once to its PDF structure element. */
export const templateBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('heading'), level: z.int().min(1).max(3), text }),
  z.strictObject({ type: z.literal('paragraph'), content: line }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(line).min(1).max(100),
  }),
  table,
  z.strictObject({ type: z.literal('page_break') }),
  /** The tenant's logo, with its alternative text. */
  z.strictObject({ type: z.literal('logo'), alt: text }),
]);

export type TemplateBlock = z.infer<typeof templateBlockSchema>;

type Line = z.infer<typeof line>;

function linesOf(block: TemplateBlock): Line[] {
  switch (block.type) {
    case 'paragraph':
      return [block.content];
    case 'list':
      return block.items;
    case 'table':
      return block.rows.flat();
    default:
      return [];
  }
}

/** Every field id a body uses, each once, in order. */
export function bodyFields(body: readonly TemplateBlock[]): string[] {
  const ids = body
    .flatMap(linesOf)
    .flatMap((parts) => parts.flatMap((part) => ('field' in part ? [part.field] : [])));
  return [...new Set(ids)];
}

/**
 * A published template version. Its merge fields are exactly the field ids
 * its body uses, so the list a reviewer reads, and a diff records, is the
 * whole of what the document can hold.
 */
export const templateVersionSchema = z
  .strictObject({
    id: idSchema,
    templateId: idSchema,
    version: z.int().min(1),
    kind: z.enum(documentKinds),
    audience: z.enum(projectionAudiences),
    /** The PDF's title, which screen readers announce. */
    title: text.max(200),
    mergeFields: z.array(fieldIdSchema).max(MAX_MERGE_FIELDS),
    body: z.array(templateBlockSchema).min(1).max(MAX_TEMPLATE_BLOCKS),
  })
  .refine(
    ({ mergeFields, body }) =>
      new Set(mergeFields).size === mergeFields.length &&
      [...mergeFields].sort().join() === bodyFields(body).sort().join(),
    says(documentsMessages.mergeFieldsMatch),
  )
  .refine(
    ({ body }) => JSON.stringify(body).length <= MAX_TEMPLATE_BODY_LENGTH,
    says(documentsMessages.bodyTooLong),
  );

export type TemplateVersion = z.infer<typeof templateVersionSchema>;

/** Why checkTemplateFields() refused a merge field. */
export const templateFieldRefusals = ['unknown', 'not_visible', 'restricted'] as const;

export type TemplateFieldRefusal = (typeof templateFieldRefusals)[number];

/** What the field checks read from a template version. */
export interface TemplateFields {
  readonly audience: ProjectionAudience;
  readonly mergeFields: readonly string[];
}

export interface TemplateFieldProblem {
  readonly fieldId: string;
  readonly reason: TemplateFieldRefusal;
}

/**
 * The merge fields a template may not use with these form fields. A field
 * that is not a question is `unknown`. Aggregate-only and special category
 * answers are `restricted` for every audience, the applicant's too, so they
 * never reach a document. Any other field the template's audience cannot
 * see under canSee() is `not_visible`. Publishing refuses a template with
 * any problem, checked against each form version it is used with.
 */
export function checkTemplateFields(
  template: TemplateFields,
  fields: readonly FormField[],
): TemplateFieldProblem[] {
  const questions = new Map(
    fields.flatMap((field) => (field.type === 'content' ? [] : [[field.id, field] as const])),
  );
  return template.mergeFields.flatMap((fieldId): TemplateFieldProblem[] => {
    const field = questions.get(fieldId);
    if (field === undefined) return [{ fieldId, reason: 'unknown' }];
    if (field.audiences === 'aggregate_only' || classificationOf(field) === 'special_category') {
      return [{ fieldId, reason: 'restricted' }];
    }
    return canSee(field, template.audience) ? [] : [{ fieldId, reason: 'not_visible' }];
  });
}

/** What the worker fills for one record: the answers it may print, and the fields it prints as "Not shown". */
export interface DocumentFields {
  readonly values: Answers;
  readonly notShown: readonly string[];
}

/** The fixed words printed for a field its audience or requester may not see on a record. */
export const NOT_SHOWN = 'Not shown';

/**
 * One record's merge fields at generation. Publishing checked the
 * template's fields, but what an audience sees depends on each record's
 * pinned form version and answers, so a field is filled only if it passes
 * checkTemplateFields() for that version, the requester may see it too,
 * and it is in the job request's field list; its value then comes from the
 * template audience's projection. Any other field is listed in `notShown`,
 * never with its value. A field that passes but has no answer shown is in
 * neither.
 */
export function documentFields(
  template: TemplateFields,
  definition: FormDefinition,
  answers: Answers,
  requester: ProjectionAudience,
  requested: readonly string[],
): DocumentFields {
  const fields = new Map(fieldsOf(definition).map((field) => [field.id, field]));
  const refused = new Set(
    checkTemplateFields(template, [...fields.values()]).map((problem) => problem.fieldId),
  );
  const asked = new Set(requested);
  const shown = projectAnswers(definition, answers, template.audience);
  const values: Record<string, unknown> = {};
  const notShown: string[] = [];
  for (const id of template.mergeFields) {
    const field = fields.get(id);
    const allowed =
      field !== undefined && !refused.has(id) && asked.has(id) && canSee(field, requester);
    if (!allowed) notShown.push(id);
    else if (Object.hasOwn(shown, id)) values[id] = shown[id];
  }
  return { values, notShown };
}

/**
 * What a member asks a generation job for, kept in `app.job_request`
 * (S11-67) and never in the job's payload, which holds the request's id
 * alone (ADR 0009). The worker makes an `app.file`, scanned like any file,
 * within the 10 MiB ceiling, and classified as its most sensitive field.
 */
export const documentRequestSchema = z.strictObject({
  templateVersionId: idSchema,
  kind: z.enum(documentKinds),
  subjectIds: z.array(idSchema).min(1).max(MAX_DOCUMENT_SUBJECTS),
});

export type DocumentRequest = z.infer<typeof documentRequestSchema>;
