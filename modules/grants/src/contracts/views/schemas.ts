// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Saved views of the submissions list (E7), shared by the whole tenant. A
// view is a name, the list's filters, a sort and the columns to show, and
// nothing else: never a resolved list of ids, a projection or answer
// values. Columns come from a closed list or name a form question by its
// stable field id (rule 7), never a free-text path.
//
// One member saves a view and another, perhaps with less access, runs it,
// so every use re-checks what is stored (S12-39, S12-49): the filters run
// inside the viewer's permissions and scope, and each answer column goes
// through the viewer's audience projection and the field's classification
// on the pinned form version. A column the viewer may not see is left out,
// so a view saved by a manager never shows a reviewer more than their own
// projection, and special category and `aggregate_only` answers never show.

import { idSchema } from '@pixel-scientists/domain';
import { fieldIdSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { programmeMessages, says as programmeSays } from '../programme/messages.ts';
import { submissionQuerySchema } from '../submissions/inputs.ts';
import { says, triageMessages } from '../triage/messages.ts';

export const MAX_VIEW_NAME_LENGTH = 80;
export const MAX_VIEW_COLUMNS = 30;

/** The list's own columns, with the words the console heads them with. */
export const viewColumns = {
  organisation: 'Organisation',
  programme: 'Programme',
  round: 'Round',
  stage: 'Stage',
  status: 'Status',
  submittedAt: 'Submitted',
  late: 'Late',
  eligibility: 'Eligibility',
  owner: 'Owner',
  labels: 'Labels',
} as const;

export type ViewColumnId = keyof typeof viewColumns;

const columnIds = Object.keys(viewColumns) as [ViewColumnId, ...ViewColumnId[]];

export const viewColumnSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('column'), id: z.enum(columnIds) }),
  z.strictObject({ kind: z.literal('answer'), fieldId: fieldIdSchema }),
]);

export type ViewColumn = z.infer<typeof viewColumnSchema>;

const columnKey = (column: ViewColumn) =>
  column.kind === 'column' ? column.id : `answer.${column.fieldId}`;

/**
 * The submissions list's filters, without its cursor, plus an owner (null
 * for none) and a label. `late` is stored as a boolean, not query text.
 */
export const viewFilterSchema = submissionQuerySchema
  .omit({ cursor: true, late: true })
  .extend({
    late: z.boolean().optional(),
    ownerId: idSchema.nullable().optional(),
    labelId: idSchema.optional(),
  })
  .strict();

export type ViewFilter = z.infer<typeof viewFilterSchema>;

export const viewSortSchema = z.strictObject({
  by: z.enum(['submittedAt', 'organisation', 'stage', 'status', 'owner']),
  direction: z.enum(['asc', 'desc']),
});

export type ViewSort = z.infer<typeof viewSortSchema>;

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export const viewInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .max(MAX_VIEW_NAME_LENGTH)
    .refine((value) => !HIDDEN.test(value), programmeSays(programmeMessages.hiddenCharacters))
    .refine((value) => value !== '', says(triageMessages.viewName)),
  filter: viewFilterSchema,
  sort: viewSortSchema,
  columns: z
    .array(viewColumnSchema)
    .min(1)
    .max(MAX_VIEW_COLUMNS)
    .refine(
      (columns) => new Set(columns.map(columnKey)).size === columns.length,
      says(triageMessages.columnOnce),
    ),
});

export type ViewInput = z.infer<typeof viewInputSchema>;

/**
 * A view as staff read it. The member who saved it is named from their
 * person record (`name` null when it has none); the view holds no other
 * personal data.
 */
export const savedViewSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  filter: viewFilterSchema,
  sort: viewSortSchema,
  columns: z.array(viewColumnSchema),
  createdBy: z.strictObject({ membershipId: idSchema, name: z.string().nullable() }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type SavedView = z.infer<typeof savedViewSchema>;

/** The tenant's views, by name. */
export const savedViewListSchema = z.strictObject({ views: z.array(savedViewSchema) });

export type SavedViewList = z.infer<typeof savedViewListSchema>;
