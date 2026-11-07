// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Due diligence checklists and their answers. A checklist is versioned
// configuration (rule 10): creating one and publishing a new version each
// record an `assure.checklist` config version whose diff lists names,
// descriptions and item fields by path, never an answer. Each item keeps the
// id the console gave it when it was added, in every version, and answers
// are keyed by those ids and pinned to the version they answer (rule 7). A
// file answer holds `app.file` ids only (ADR 0030).
//
// - `assure.checklists.manage` lists, reads, creates
//   (`assure.checklist.created`) and publishes (`assure.checklist.published`).
// - `assure.checklists.complete` reads and saves an application's answers
//   (`assure.checklist_response.saved`), with the pinned version in full. A
//   save naming another version than the one pinned answers 409.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { MAX_FILES_PER_FIELD } from '@pixel-scientists/domain/files';
import { z } from 'zod';

import { assureMessages, says } from './messages.ts';
import { choice, dateSchema, line, paragraphs, timestampSchema, unique } from './schemas.ts';

export const answerKinds = ['yes_no', 'date', 'short_text', 'file'] as const;

/** A yes or no answer, where not applicable is also an answer. */
export const yesNoValues = ['yes', 'no', 'not_applicable'] as const;

/** The most items a checklist has. */
export const MAX_CHECKLIST_ITEMS = 100;

const itemInputSchema = z.strictObject({
  id: idSchema,
  label: line(200, assureMessages.itemLabel),
  help: paragraphs(1000).default(''),
  kind: choice(answerKinds, assureMessages.answerKind),
  required: z.boolean(),
});

/** A whole checklist, its items in order. */
export const checklistInputSchema = z.strictObject({
  name: line(120, assureMessages.checklistName),
  description: paragraphs(2000).default(''),
  items: z
    .array(itemInputSchema)
    .min(1)
    .max(MAX_CHECKLIST_ITEMS)
    .refine(...unique((item: { id: string }) => item.id)),
});

export type ChecklistInput = z.infer<typeof checklistInputSchema>;

export const checklistVersionSchema = z.strictObject({
  id: idSchema,
  number: z.int().min(1),
  name: z.string(),
  description: z.string(),
  items: z.array(
    z.strictObject({
      id: idSchema,
      label: z.string(),
      help: z.string(),
      kind: z.enum(answerKinds),
      required: z.boolean(),
    }),
  ),
  publishedAt: timestampSchema,
});

export type ChecklistVersion = z.infer<typeof checklistVersionSchema>;

/** A checklist with its newest version. */
export const checklistSchema = z.strictObject({ id: idSchema, version: checklistVersionSchema });

export const checklistListSchema = z.strictObject({
  checklists: z.array(
    z.strictObject({
      id: idSchema,
      name: z.string(),
      versionNumber: z.int().min(1),
      publishedAt: timestampSchema,
    }),
  ),
});

const fileIds = z
  .array(idSchema)
  .min(1)
  .max(MAX_FILES_PER_FIELD)
  .refine(...unique((id: string) => id));

/** One answer, of the kind its item asks for; the server checks the kind against the version. */
const answerInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('yes_no'), value: choice(yesNoValues, assureMessages.yesNo) }),
  z.strictObject({ kind: z.literal('date'), value: dateSchema }),
  z.strictObject({ kind: z.literal('short_text'), value: line(500, assureMessages.answerText) }),
  z.strictObject({ kind: z.literal('file'), fileIds }),
]);

/** Answers by item id, against one version of the checklist. */
export const checklistResponseInputSchema = z.strictObject({
  versionId: idSchema,
  answers: z
    .record(idSchema, answerInputSchema)
    .refine(
      (answers) => Object.keys(answers).length <= MAX_CHECKLIST_ITEMS,
      says(assureMessages.tooManyAnswers),
    ),
});

export type ChecklistResponseInput = z.infer<typeof checklistResponseInputSchema>;

const answerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('yes_no'), value: z.enum(yesNoValues) }),
  z.strictObject({ kind: z.literal('date'), value: dateSchema }),
  z.strictObject({ kind: z.literal('short_text'), value: z.string() }),
  z.strictObject({ kind: z.literal('file'), fileIds: z.array(idSchema) }),
]);

/**
 * An application's answers to one checklist, with the version they are
 * pinned to, or the newest version and no answers before the first save.
 * `complete` when every required item is answered.
 */
export const checklistResponseSchema = z.strictObject({
  checklistId: idSchema,
  applicationId: idSchema,
  version: checklistVersionSchema,
  answers: z.record(idSchema, answerSchema),
  complete: z.boolean(),
  savedAt: timestampSchema.nullable(),
});

export type ChecklistResponse = z.infer<typeof checklistResponseSchema>;

/** Every checklist, with where the application's answers stand. */
export const applicationChecklistListSchema = z.strictObject({
  checklists: z.array(
    z.strictObject({
      checklistId: idSchema,
      name: z.string(),
      versionId: idSchema,
      complete: z.boolean(),
      savedAt: timestampSchema.nullable(),
    }),
  ),
});

const staff = { audience: 'console', module: 'assure', scope: 'tenant' } as const;

const manage = { ...staff, permission: 'assure.checklists.manage' } as const;

const complete = { ...staff, permission: 'assure.checklists.complete' } as const;

const checklist = { params: z.strictObject({ checklistId: idSchema }) } as const;

const response = {
  params: z.strictObject({ applicationId: idSchema, checklistId: idSchema }),
} as const;

export const listChecklists = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/checklists',
  summary: 'List due diligence checklists by name',
  responses: { 200: checklistListSchema },
});

export const getChecklist = defineRoute({
  ...manage,
  ...checklist,
  method: 'GET',
  path: '/console/checklists/:checklistId',
  summary: 'Read a checklist with its newest version',
  responses: { 200: checklistSchema },
});

export const createChecklist = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/checklists',
  summary: 'Create a checklist and publish its first version',
  body: checklistInputSchema,
  responses: { 201: checklistSchema },
});

export const publishChecklistVersion = defineRoute({
  ...manage,
  ...checklist,
  method: 'POST',
  idempotent: true,
  path: '/console/checklists/:checklistId/versions',
  summary: 'Publish a new version of a checklist, keeping earlier answers on theirs',
  body: checklistInputSchema,
  responses: { 201: checklistSchema },
});

export const listApplicationChecklists = defineRoute({
  ...complete,
  method: 'GET',
  path: '/console/applications/:applicationId/checklists',
  summary: "List the checklists and how far an application's answers have got",
  params: z.strictObject({ applicationId: idSchema }),
  responses: { 200: applicationChecklistListSchema },
});

export const getChecklistResponse = defineRoute({
  ...complete,
  ...response,
  method: 'GET',
  path: '/console/applications/:applicationId/checklists/:checklistId',
  summary: "Read an application's answers to a checklist, with the version they answer",
  responses: { 200: checklistResponseSchema },
});

export const saveChecklistResponse = defineRoute({
  ...complete,
  ...response,
  method: 'PUT',
  path: '/console/applications/:applicationId/checklists/:checklistId',
  summary: "Save an application's answers to a checklist",
  body: checklistResponseInputSchema,
  responses: { 200: checklistResponseSchema },
});

export const checklistRoutes = {
  listChecklists,
  getChecklist,
  createChecklist,
  publishChecklistVersion,
  listApplicationChecklists,
  getChecklistResponse,
  saveChecklistResponse,
} as const;
