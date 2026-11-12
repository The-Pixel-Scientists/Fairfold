// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Targets: the figure an indicator should reach over a period, for one
// programme or for the funder as a whole, with the baseline it started from
// where one is known. An indicator has one target for each programme and
// period. A programme is named by its id alone, which the server checks
// through grants' contract when that tool is on; impact works without it.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { figureSchema } from './figures.ts';
import { impactMessages, says } from './messages.ts';
import { itemIdSchema, periodInOrder, periodShape, timestampSchema } from './schemas.ts';

const figures = { baseline: figureSchema.nullable(), target: figureSchema };

export const targetInputSchema = z
  .strictObject({
    frameworkId: idSchema,
    indicatorId: itemIdSchema,
    programmeId: idSchema.nullable(),
    ...periodShape,
    ...figures,
  })
  .refine(periodInOrder, { ...says(impactMessages.periodOrder), path: ['periodEnd'] });

export type TargetInput = z.infer<typeof targetInputSchema>;

/** A target stays with its indicator, programme and period. */
export const targetUpdateSchema = z.strictObject(figures);

export type TargetUpdate = z.infer<typeof targetUpdateSchema>;

export const targetSchema = z.object({
  id: idSchema,
  frameworkId: idSchema,
  indicatorId: itemIdSchema,
  programmeId: idSchema.nullable(),
  ...periodShape,
  baseline: z.number().nullable(),
  target: z.number(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Target = z.infer<typeof targetSchema>;

/** A framework's targets, by indicator and then by period, earliest first. */
export const targetListSchema = z.object({ targets: z.array(targetSchema) });

export type TargetList = z.infer<typeof targetListSchema>;
