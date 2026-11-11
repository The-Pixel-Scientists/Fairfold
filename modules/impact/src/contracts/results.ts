// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Results: the figure reported for an indicator over a period, for one
// programme or for the funder as a whole, with a note and evidence. A result
// is a total about the work, never a record about one person: it names no
// party, and the console says so beside the note. The note is still free
// text and may name people, so it is classified as personal.
//
// Evidence is `app.file` ids with a caption (ADR 0030); files are uploaded
// through the platform's file routes first. A result a grantee reports on a
// monitoring form arrives with the source `monitoring_report` once grants'
// post-award monitoring exists; a member records the rest by hand.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { figureSchema } from './figures.ts';
import { impactMessages, says } from './messages.ts';
import {
  cursorSchema,
  itemIdSchema,
  line,
  paragraphs,
  periodInOrder,
  periodShape,
  timestampSchema,
  unique,
} from './schemas.ts';

export const resultSources = ['manual', 'monitoring_report'] as const;

export type ResultSource = (typeof resultSources)[number];

export const MAX_EVIDENCE = 20;

const evidenceSchema = z.strictObject({ fileId: idSchema, caption: z.string() });

/** What a result records, besides what it is for. */
const resultShape = {
  value: figureSchema,
  note: paragraphs(2000),
  evidence: z
    .array(evidenceSchema.extend({ caption: line(200, impactMessages.caption) }))
    .max(MAX_EVIDENCE)
    .refine(...unique((item: { fileId: string }) => item.fileId)),
};

export const resultInputSchema = z
  .strictObject({
    frameworkId: idSchema,
    indicatorId: itemIdSchema,
    programmeId: idSchema.nullable(),
    ...periodShape,
    ...resultShape,
  })
  .refine(periodInOrder, { ...says(impactMessages.periodOrder), path: ['periodEnd'] });

export type ResultInput = z.infer<typeof resultInputSchema>;

/** A correction: a result stays with its indicator, programme and period. */
export const resultUpdateSchema = z.strictObject(resultShape);

export type ResultUpdate = z.infer<typeof resultUpdateSchema>;

export const resultSchema = z.object({
  id: idSchema,
  frameworkId: idSchema,
  indicatorId: itemIdSchema,
  programmeId: idSchema.nullable(),
  ...periodShape,
  value: z.number(),
  note: z.string(),
  evidence: z.array(evidenceSchema),
  source: z.enum(resultSources),
  recordedAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Result = z.infer<typeof resultSchema>;

/** A framework's results, latest period first, for one indicator or programme or all. */
export const resultQuerySchema = z.strictObject({
  frameworkId: idSchema,
  indicatorId: itemIdSchema.optional(),
  programmeId: idSchema.optional(),
  cursor: cursorSchema.optional(),
});

export type ResultQuery = z.infer<typeof resultQuerySchema>;

export const resultPageSchema = z.object({
  results: z.array(
    resultSchema.omit({ note: true, evidence: true }).extend({ evidenceCount: z.int().min(0) }),
  ),
  nextCursor: cursorSchema.nullable(),
});

export type ResultPage = z.infer<typeof resultPageSchema>;
