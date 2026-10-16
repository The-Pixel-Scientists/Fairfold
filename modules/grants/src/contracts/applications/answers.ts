// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the portal's application routes answer (ADR 0004). These are the
// applicant's answers only, built here and never from a staff schema. No
// stage, score, reviewer or decision field appears in them: the one decision
// field is `outcome`, which applicantOutcome() leaves null until release.
// Times on a round are local to its `timeZone`, as `2027-02-02T17:00`.

import { idSchema } from '@pixel-scientists/domain';
import { projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { fieldIdSchema, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { moneySchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { applicantOutcomeSchema, applicantStatusSchema } from './status.ts';

/** A round taking applications, as the list of rounds shows it. */
export const openRoundSchema = z.object({
  id: idSchema,
  title: z.string(),
  programme: z.object({ id: idSchema, title: z.string(), summary: z.string() }),
  closesAt: z.string(),
  timeZone: z.string(),
  awardMinimum: moneySchema,
  awardMaximum: moneySchema,
});

export type OpenRound = z.infer<typeof openRoundSchema>;

/** The rounds taking applications, closing soonest first. */
export const openRoundListSchema = z.object({ rounds: z.array(openRoundSchema) });

export type OpenRoundList = z.infer<typeof openRoundListSchema>;

/** A published form version, which an application pins when it starts. */
const formSchema = z.object({ id: idSchema, definition: formDefinitionSchema });

/** One open round, with what the programme is for and the form new applications use. */
export const openRoundDetailSchema = openRoundSchema.extend({
  programme: z.object({
    id: idSchema,
    title: z.string(),
    summary: z.string(),
    description: z.string(),
  }),
  form: formSchema,
});

export type OpenRoundDetail = z.infer<typeof openRoundDetailSchema>;

/** Where checkEligibility() leaves the saved answers: `stopped` names the question and why. */
export const eligibilitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('eligible') }),
  z.object({ status: z.literal('stopped'), fieldId: fieldIdSchema, explanation: z.string() }),
  z.object({ status: z.literal('incomplete') }),
]);

export type Eligibility = z.infer<typeof eligibilitySchema>;

/** One of the applicant's applications, as their list shows it. */
export const applicationSummarySchema = z.object({
  id: idSchema,
  round: z.object({
    id: idSchema,
    title: z.string(),
    programmeTitle: z.string(),
    closesAt: z.string(),
    timeZone: z.string(),
  }),
  organisation: z.object({ id: idSchema, name: z.string() }),
  status: applicantStatusSchema,
  /** When the answers were last saved. */
  updatedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
  outcome: applicantOutcomeSchema.nullable(),
});

export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

/** The applicant's applications, the most recently changed first. */
export const applicationListSchema = z.object({ applications: z.array(applicationSummarySchema) });

export type ApplicationList = z.infer<typeof applicationListSchema>;

/**
 * One application: its answers projected for the applicant from the pinned
 * form version, which comes with them, and where its eligibility stands.
 * `answersVersion` counts saves, and the next save names it as `basedOn`.
 */
export const applicationSchema = applicationSummarySchema.extend({
  form: formSchema,
  answers: projectedAnswersSchemas.applicant,
  answersVersion: z.int(),
  eligibility: eligibilitySchema,
  withdrawnAt: z.iso.datetime().nullable(),
});

export type Application = z.infer<typeof applicationSchema>;

/** A save's result: the version the next save is based on. */
export const answersSavedSchema = z.object({
  answersVersion: z.int(),
  updatedAt: z.iso.datetime(),
});

export type AnswersSaved = z.infer<typeof answersSavedSchema>;
