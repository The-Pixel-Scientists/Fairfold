// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the console's submission routes answer (ADR 0004). These are staff
// answers only, never reused for applicants or reviewers. A submission is
// an application that has been submitted, and its id is the application's;
// drafts never appear. Answers are projected for staff, so aggregate-only
// answers never reach them.

import { idSchema } from '@pixel-scientists/domain';
import { projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { fieldIdSchema, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { eligibilityOutcomeSchema, submissionStatusSchema } from '../applications/lists.ts';

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const submissionCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

const stageRefSchema = z.object({ id: idSchema, name: z.string() });

/** A submission in the list. `eligibility` is its latest recorded check, null if none. */
export const submissionSummarySchema = z.object({
  id: idSchema,
  programme: z.object({ id: idSchema, title: z.string() }),
  round: z.object({ id: idSchema, title: z.string() }),
  stage: stageRefSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  status: submissionStatusSchema,
  submittedAt: z.iso.datetime(),
  late: z.boolean(),
  eligibility: eligibilityOutcomeSchema.nullable(),
});

export type SubmissionSummary = z.infer<typeof submissionSummarySchema>;

/**
 * One page of submissions, the latest submitted first. `total` counts every
 * submission the filters match; `nextCursor` is null on the last page.
 */
export const submissionPageSchema = z.object({
  submissions: z.array(submissionSummarySchema),
  total: z.int(),
  nextCursor: submissionCursorSchema.nullable(),
});

export type SubmissionPage = z.infer<typeof submissionPageSchema>;

/**
 * An eligibility check as recorded, against the pinned form version.
 * `fieldId` is the question that stopped the applicant, set exactly when stopped.
 */
export const eligibilityCheckSchema = z.object({
  outcome: eligibilityOutcomeSchema,
  fieldId: fieldIdSchema.nullable(),
  checkedAt: z.iso.datetime(),
});

export type EligibilityCheck = z.infer<typeof eligibilityCheckSchema>;

/** Who did it, by their person record's name; null when it has none. */
const bySchema = z.string().nullable();

/**
 * A change to a submission. Submitting puts it in the round's first stage,
 * so a `stage_changed` with no `from` follows it.
 */
export const submissionEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('submitted'), at: z.iso.datetime(), by: bySchema }),
  z.object({
    event: z.literal('stage_changed'),
    at: z.iso.datetime(),
    by: bySchema,
    from: stageRefSchema.nullable(),
    to: stageRefSchema,
  }),
  z.object({ event: z.literal('withdrawn'), at: z.iso.datetime(), by: bySchema }),
]);

export type SubmissionEvent = z.infer<typeof submissionEventSchema>;

/**
 * One submission: its answers projected for staff from the pinned form
 * version, which comes with them; the organisation and the applicant who
 * made it, through the party contract; eligibility checks, newest first;
 * and its history, oldest first. Identifiers are as party stores them, each
 * marked verified by staff or not.
 */
export const submissionSchema = submissionSummarySchema.extend({
  form: z.object({ id: idSchema, version: z.int(), definition: formDefinitionSchema }),
  answers: projectedAnswersSchemas.staff,
  organisation: z.object({
    id: idSchema,
    name: z.string(),
    legalForm: z.string(),
    identifiers: z.array(
      z.object({ scheme: z.string(), identifier: z.string(), verified: z.boolean() }),
    ),
  }),
  contact: z.object({
    personId: idSchema,
    givenName: z.string().nullable(),
    familyName: z.string().nullable(),
    email: z.string(),
  }),
  withdrawnAt: z.iso.datetime().nullable(),
  eligibilityChecks: z.array(eligibilityCheckSchema),
  history: z.array(submissionEventSchema),
});

export type Submission = z.infer<typeof submissionSchema>;

/** How many submissions moved; those already in the stage are left as they are. */
export const stageMoveResultSchema = z.object({ moved: z.int() });

export type StageMoveResult = z.infer<typeof stageMoveResultSchema>;
