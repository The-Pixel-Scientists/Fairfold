// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form version routes answer. These are staff answers only: the
// portal reads a published form through its own contracts (S06-04).

import { idSchema } from '@pixel-scientists/domain';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { formVersionStatusSchema } from './lists.ts';

/**
 * A version as the round's list shows it. `version` counts from 1 in the
 * round. `publishedAt` and `publishedBy` are set exactly when it is
 * published; the author is named from their person record when they have one.
 */
export const formVersionSummarySchema = z.object({
  id: idSchema,
  version: z.int(),
  status: formVersionStatusSchema,
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  publishedBy: z.object({ membershipId: idSchema, name: z.string().nullable() }).nullable(),
});

export type FormVersionSummary = z.infer<typeof formVersionSummarySchema>;

/** A round's versions, the newest first. */
export const formVersionListSchema = z.object({ versions: z.array(formVersionSummarySchema) });

export type FormVersionList = z.infer<typeof formVersionListSchema>;

/**
 * One version with its definition. The definition is null only for a draft
 * that started empty and has not been saved yet.
 */
export const formVersionSchema = formVersionSummarySchema.extend({
  roundId: idSchema,
  definition: formDefinitionSchema.nullable(),
});

export type FormVersion = z.infer<typeof formVersionSchema>;
