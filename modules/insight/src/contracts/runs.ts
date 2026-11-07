// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Report runs. A run is computed inside the request and its figures are
// answered once: they are stored nowhere (ADR 0032), so reading a run back
// gives who ran which version of a report, when, and what came of it, but
// never its figures. Running answers 200, not 201: a repeat is a fresh run,
// since a replay could only read the run back without them.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { reportKinds } from './definitions.ts';

/** Shown; withheld whole for too few responses; or refused by the run log. */
export const reportRunOutcomes = ['shown', 'withheld', 'refused'] as const;

export type ReportRunOutcome = (typeof reportRunOutcomes)[number];

export const reportRunSchema = z.object({
  id: idSchema,
  reportId: idSchema,
  reportVersion: z.int().min(1),
  kind: z.enum(reportKinds),
  outcome: z.enum(reportRunOutcomes),
  /** For a monitoring run, the disclosure rule version applied; null for the platform floor. */
  disclosureRuleVersion: z.int().min(1).nullable(),
  ranAt: z.iso.datetime(),
  ranByMembershipId: idSchema,
});

export type ReportRun = z.infer<typeof reportRunSchema>;

/** The most rows a warehouse report answers; past it, `truncated` is true. */
export const MAX_REPORT_ROWS = 1000;

/** A warehouse report's figures: a column for each group, then each measure, by item id. */
export const reportResultSchema = z.object({
  run: reportRunSchema,
  columns: z.array(z.object({ itemId: idSchema, role: z.enum(['group', 'measure']) })),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .max(MAX_REPORT_ROWS),
  truncated: z.boolean(),
});

export type ReportResult = z.infer<typeof reportResultSchema>;
