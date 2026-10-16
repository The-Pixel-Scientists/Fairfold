// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the programme set-up routes accept. Inputs are strict and never name
// a user or tenant. A round's times are local to the tenant's time zone,
// which the server reads from settings and records with the round; the
// database and the API check the same rules.

import { idSchema } from '@pixel-scientists/domain';
import { catalogueParams, messages, moneySchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { latePolicySchema, programmeStatusSchema } from './lists.ts';
import { programmeMessages, says, type ProgrammeMessage } from './messages.ts';
import { line, paragraphs } from './text.ts';

export const programmeInputSchema = z.strictObject({
  title: line(120, programmeMessages.programmeTitle),
  /** Shown to applicants. */
  summary: line(300, programmeMessages.programmeSummary),
  description: paragraphs(5000).default(''),
  status: programmeStatusSchema.default('draft'),
});

export type ProgrammeInput = z.infer<typeof programmeInputSchema>;

/** The largest budget or award, in minor units: £1,000,000,000. The database checks the same bound. */
export const MAX_AMOUNT_MINOR = 100_000_000_000;

/** A budget or award: more than nothing, and no more than MAX_AMOUNT_MINOR. */
export const amountSchema = moneySchema.extend({
  amountMinor: z
    .int()
    .refine((amount) => amount > 0, { ...says(programmeMessages.amountPositive), abort: true })
    .refine((amount) => amount <= MAX_AMOUNT_MINOR, says(programmeMessages.amountTooLarge)),
});

/**
 * A date and time on the wall clock, to the minute, with no offset:
 * `2027-02-02T09:00`. Values of the same form compare in time order as text.
 */
export const localDateTimeSchema = z.iso
  .datetime({ local: true, precision: -1, error: messages.enterValidDate })
  .refine((value) => !value.endsWith('Z'), { error: messages.enterValidDate });

/** Options for a check of `field` against `other`, which runs once both are valid on their own. */
function across(field: string, other: string, message: ProgrammeMessage) {
  return {
    ...says(message),
    path: [field],
    when: ({ issues }: z.core.ParsePayload) =>
      !issues.some((issue) => [field, other].includes(String(issue.path?.[0]))),
  };
}

export const roundInputSchema = z
  .strictObject({
    title: line(120, programmeMessages.roundTitle),
    opensAt: localDateTimeSchema,
    closesAt: localDateTimeSchema,
    budget: amountSchema,
    awardMinimum: amountSchema,
    awardMaximum: amountSchema,
    latePolicy: latePolicySchema,
  })
  .refine(
    (round) => round.closesAt > round.opensAt,
    across('closesAt', 'opensAt', programmeMessages.closesAfterOpens),
  )
  .refine(
    (round) => round.awardMaximum.amountMinor >= round.awardMinimum.amountMinor,
    across('awardMaximum', 'awardMinimum', programmeMessages.awardMaximum),
  )
  .refine(
    (round) => round.budget.amountMinor >= round.awardMaximum.amountMinor,
    across('budget', 'awardMaximum', programmeMessages.budget),
  );

export type RoundInput = z.infer<typeof roundInputSchema>;

/** Flags each item after the first whose key repeats an earlier one. Items with no key are skipped. */
function once<T>(key: (item: T) => string | undefined, field: string, message: ProgrammeMessage) {
  return (items: T[], context: z.RefinementCtx<T[]>) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const value = key(item);
      if (value === undefined) return;
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          message,
          params: catalogueParams,
          path: [index, field],
        });
      }
      seen.add(value);
    });
  };
}

/** The most stages a round has. */
export const MAX_STAGES = 10;

/** The most criteria a stage's rubric has. */
export const MAX_CRITERIA = 20;

/**
 * A round's stages in order. A stage with an id keeps it, and its
 * applications and rubric; one without is added; one left out is removed.
 */
export const stagesInputSchema = z.strictObject({
  stages: z
    .array(
      z.strictObject({
        id: idSchema.optional(),
        name: line(60, programmeMessages.stageName),
      }),
    )
    .min(1)
    .max(MAX_STAGES)
    .superRefine(once((stage) => stage.id, 'id', programmeMessages.listedOnce))
    .superRefine(
      once(
        (stage) => stage.name.toLocaleLowerCase('en-GB') || undefined,
        'name',
        programmeMessages.stageNamesUnique,
      ),
    ),
});

export type StagesInput = z.infer<typeof stagesInputSchema>;

/**
 * A stage's rubric: the criteria reviewers score, in order. A criterion with
 * an id keeps it, and the scores that refer to it. No criteria means the
 * stage has no rubric; a stage with one is a review stage.
 */
export const rubricInputSchema = z.strictObject({
  criteria: z
    .array(
      z
        .strictObject({
          id: idSchema.optional(),
          label: line(100, programmeMessages.criterionLabel),
          guidance: paragraphs(1000).default(''),
          weight: z.int().min(1).max(100),
          scaleMin: z.int().min(0).max(9).default(1),
          scaleMax: z.int().min(1).max(10).default(5),
        })
        .refine((criterion) => criterion.scaleMin < criterion.scaleMax, {
          ...says(programmeMessages.scale),
          path: ['scaleMax'],
        }),
    )
    .max(MAX_CRITERIA)
    .superRefine(once((criterion) => criterion.id, 'id', programmeMessages.listedOnce)),
});

export type RubricInput = z.infer<typeof rubricInputSchema>;
