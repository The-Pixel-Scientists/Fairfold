// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Learning notes: what a funder's staff learned from the results, kept
// against a framework and, where it helps, one of its outcomes. A note is
// about the work and must not name a person, as the console says beside
// the box, so it is classified as internal (packages/db/classification).
// It is added or removed, never edited, so what was learned when stays on
// record.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { impactMessages, says } from './messages.ts';
import { itemIdSchema, paragraphs, timestampSchema } from './schemas.ts';

export const learningNoteInputSchema = z.strictObject({
  frameworkId: idSchema,
  outcomeId: itemIdSchema.nullable(),
  text: paragraphs(5000).refine((value) => value !== '', says(impactMessages.note)),
});

export type LearningNoteInput = z.infer<typeof learningNoteInputSchema>;

export const learningNoteSchema = z.object({
  id: idSchema,
  frameworkId: idSchema,
  outcomeId: itemIdSchema.nullable(),
  text: z.string(),
  createdAt: timestampSchema,
});

export type LearningNote = z.infer<typeof learningNoteSchema>;

/** A framework's notes, newest first. */
export const learningNoteListSchema = z.object({ notes: z.array(learningNoteSchema) });

export type LearningNoteList = z.infer<typeof learningNoteListSchema>;
