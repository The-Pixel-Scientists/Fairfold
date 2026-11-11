// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A framework's progress: for each indicator, its results combined by the
// indicator's own rule, beside its target and baseline. The summary reads
// what members recorded and shows it to members who may already read each
// result, so nothing is hidden here. Aggregates that leave the console, in
// the warehouse or a publication, take the small-number rule of ADR 0032
// when impact's data contract is written.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { impactMessages, says } from './messages.ts';
import { dateSchema, itemIdSchema } from './schemas.ts';

/** For one programme or all, over results whose periods lie within the dates given. */
export const summaryQuerySchema = z
  .strictObject({
    programmeId: idSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    ...says(impactMessages.periodOrder),
    path: ['to'],
  });

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

export const indicatorSummarySchema = z.object({
  indicatorId: itemIdSchema,
  /** The results combined by the indicator's rule; null when there are none. */
  value: z.number().nullable(),
  resultCount: z.int().min(0),
  /** The end of the latest period with a result. */
  latestPeriodEnd: dateSchema.nullable(),
  /** The targets and baselines in range, combined by the same rule; null when none is set. */
  target: z.number().nullable(),
  baseline: z.number().nullable(),
});

export type IndicatorSummary = z.infer<typeof indicatorSummarySchema>;

/** One entry for each of the framework's indicators, in the framework's order. */
export const frameworkSummarySchema = z.object({
  frameworkId: idSchema,
  version: z.int().min(1),
  indicators: z.array(indicatorSummarySchema),
});

export type FrameworkSummary = z.infer<typeof frameworkSummarySchema>;
