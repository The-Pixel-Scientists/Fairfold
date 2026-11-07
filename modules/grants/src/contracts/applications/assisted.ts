// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assisted submission: the alternative route, where a member starts, fills
// in and submits an application for an applicant who cannot use the portal
// (ADR 0004, architecture rules 6 and 9). Console only, under
// `grants.applications.assist` in the session's tenant.
//
// The rules:
// - every route is refused unless the organisation has a live
//   `alternative_route` adjustment in the round (not removed);
// - an application's submission route is set when it is created and never
//   changes: starting here creates a new `assisted` application, and a
//   `portal` one never becomes assisted. Every `:applicationId` route answers
//   404 unless the application's route is `assisted`, so the applicant's own
//   draft never reaches the console;
// - starting answers 409 (`alreadyApplying`) while the organisation has an
//   application in the round that is not withdrawn, whichever its route, as
//   the portal's one live application rule says;
// - starting and submitting need step-up (ADR 0010), and starting is
//   idempotent;
// - the applicant stays the organisation and the contact person named at
//   the start, who must be a current contact for it; the acting member comes
//   from the session and is recorded as `submittedBy`, never from a body;
// - answers, saves, eligibility and submitting use the portal's own schemas
//   and rules (inputs.ts, answers.ts), with no second answer format: the same
//   pinned form version, `basedOn` versions, validation, eligibility,
//   effective closing time and late policy;
// - an assisted draft is read only through these routes: it never appears in
//   the console's submissions list or the applicant's portal until it is
//   submitted, and the member never sees or fills in the equality
//   monitoring form, which the applicant is invited to answer themselves;
// - every route but the list is audited (assistedAuditActions), with the
//   member as actor and the contact person's party id as subject (ADR 0027).
//   Unlike the portal's autosaves, each save is audited, since a member is
//   writing in the applicant's name: the event holds the application id, the
//   new answers version and the changed field ids, never a value. Submitting
//   also records `.submitted_on_behalf`, and the applicant is told.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import type { GrantsAuditAction } from '../audit.ts';
import { submissionSchema } from '../submissions/answers.ts';
import { answersSavedSchema, eligibilitySchema } from './answers.ts';
import { saveAnswersInputSchema, submitApplicationInputSchema } from './inputs.ts';

/** The organisation applying and its contact person, the applicant, as party ids. */
export const startAssistedInputSchema = z.strictObject({
  organisationId: idSchema,
  contactPersonId: idSchema,
});

export type StartAssistedInput = z.infer<typeof startAssistedInputSchema>;

/** An assisted draft in a round's list. */
export const assistedSummarySchema = z.object({
  id: idSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  contact: z.object({ personId: idSchema, name: z.string().nullable() }),
  updatedAt: z.iso.datetime(),
});

/** A round's assisted drafts, the most recently changed first. */
export const assistedListSchema = z.object({ applications: z.array(assistedSummarySchema) });

export type AssistedList = z.infer<typeof assistedListSchema>;

/**
 * An assisted draft: its answers projected for staff from the pinned form
 * version, and when it closes by effectiveClosingTime(), local to `timeZone`.
 */
export const assistedApplicationSchema = assistedSummarySchema.extend({
  round: z.object({ id: idSchema, title: z.string() }),
  closesAt: z.string(),
  timeZone: z.string(),
  form: z.object({ id: idSchema, definition: formDefinitionSchema }),
  answers: projectedAnswersSchemas.staff,
  answersVersion: z.int(),
  eligibility: eligibilitySchema,
});

export type AssistedApplication = z.infer<typeof assistedApplicationSchema>;

const assist = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.assist',
  scope: 'tenant',
} as const;

const round = { ...assist, params: z.strictObject({ roundId: idSchema }) } as const;

const draft = { ...assist, params: z.strictObject({ applicationId: idSchema }) } as const;

export const listAssistedApplications = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/assisted-applications',
  summary: "List a round's assisted drafts, the most recently changed first",
  responses: { 200: assistedListSchema },
});

export const startAssistedApplication = defineRoute({
  ...round,
  method: 'POST',
  idempotent: true,
  stepUp: true,
  path: '/console/rounds/:roundId/assisted-applications',
  summary: 'Start an application for an organisation that has the alternative route',
  body: startAssistedInputSchema,
  responses: { 201: assistedApplicationSchema },
});

export const getAssistedApplication = defineRoute({
  ...draft,
  method: 'GET',
  path: '/console/assisted-applications/:applicationId',
  summary: 'Read an assisted draft with its form and answers',
  responses: { 200: assistedApplicationSchema },
});

export const saveAssistedAnswers = defineRoute({
  ...draft,
  method: 'PUT',
  path: '/console/assisted-applications/:applicationId/answers',
  summary: "Save an assisted draft's answers, based on its latest answers version",
  body: saveAnswersInputSchema,
  responses: { 200: answersSavedSchema },
});

export const checkAssistedEligibility = defineRoute({
  ...draft,
  method: 'POST',
  path: '/console/assisted-applications/:applicationId/eligibility-check',
  summary: "Check an assisted draft's saved answers for eligibility",
  responses: { 200: eligibilitySchema },
});

export const submitAssistedApplication = defineRoute({
  ...draft,
  method: 'POST',
  stepUp: true,
  path: '/console/assisted-applications/:applicationId/submit',
  summary: "Submit an assisted draft's saved answers for the applicant",
  body: submitApplicationInputSchema,
  responses: { 200: submissionSchema },
});

export const assistedRoutes = {
  listAssistedApplications,
  startAssistedApplication,
  getAssistedApplication,
  saveAssistedAnswers,
  checkAssistedEligibility,
  submitAssistedApplication,
} as const;

/**
 * The audit events each assisted route records. The list records none, as
 * the console's submissions list does not; reading one draft does.
 */
export const assistedAuditActions = {
  listAssistedApplications: [],
  startAssistedApplication: ['grants.application.created'],
  getAssistedApplication: ['grants.application.viewed'],
  saveAssistedAnswers: ['grants.application.answers_saved_on_behalf'],
  checkAssistedEligibility: ['grants.application.eligibility_checked'],
  submitAssistedApplication: [
    'grants.application.submitted',
    'grants.application.submitted_on_behalf',
  ],
} as const satisfies Record<keyof typeof assistedRoutes, readonly GrantsAuditAction[]>;
