// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant's application routes (ADR 0004), under
// `grants.applications.apply`. Rounds are reached through `open_round`: the
// programme is open, the round has opened and not closed, and it has a
// published form. Applications are reached through `own_application`: the
// caller's own. Anything else answers 404, as if it did not exist.
//
// The MVP1 rules:
// - an organisation has one live application per round; withdrawn ones do
//   not count, and starting a second answers 409;
// - an application pins the round's latest published form version when it
//   starts, and is checked against that version from then on;
// - only a draft's answers change, and a save or submit based on an older
//   `answersVersion` answers 409, so a second tab never overwrites the first;
// - submitting checks the saved answers, eligibility and the round's closing
//   time on the server; a late submission is refused or marked late, as the
//   round's late policy says;
// - a submitted application can be withdrawn until its decision is
//   released, and withdrawing cannot be undone;
// - autosaves are not audited, being the applicant's own unsubmitted work;
//   starting, checking eligibility, submitting and withdrawing are.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  answersSavedSchema,
  applicationListSchema,
  applicationSchema,
  eligibilitySchema,
  openRoundDetailSchema,
  openRoundListSchema,
} from './answers.ts';
import {
  saveAnswersInputSchema,
  startApplicationInputSchema,
  submitApplicationInputSchema,
} from './inputs.ts';

const apply = {
  audience: 'portal',
  module: 'grants',
  permission: 'grants.applications.apply',
} as const;

const round = {
  ...apply,
  scope: 'open_round',
  params: z.strictObject({ roundId: idSchema }),
} as const;

const mine = { ...apply, scope: 'own_application' } as const;

const application = { ...mine, params: z.strictObject({ applicationId: idSchema }) } as const;

export const listOpenRounds = defineRoute({
  ...apply,
  scope: 'open_round',
  method: 'GET',
  path: '/portal/rounds',
  summary: 'List the rounds taking applications, closing soonest first',
  responses: { 200: openRoundListSchema },
});

export const getOpenRound = defineRoute({
  ...round,
  method: 'GET',
  path: '/portal/rounds/:roundId',
  summary: 'Read a round taking applications, with its programme and published form',
  responses: { 200: openRoundDetailSchema },
});

export const startApplication = defineRoute({
  ...round,
  method: 'POST',
  path: '/portal/rounds/:roundId/applications',
  summary: "Start an application for one of the caller's organisations, on the published form",
  body: startApplicationInputSchema,
  responses: { 201: applicationSchema },
});

export const listApplications = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications',
  summary: "List the caller's applications, the most recently changed first",
  responses: { 200: applicationListSchema },
});

export const getApplication = defineRoute({
  ...application,
  method: 'GET',
  path: '/portal/applications/:applicationId',
  summary: "Read one of the caller's applications",
  responses: { 200: applicationSchema },
});

export const saveApplicationAnswers = defineRoute({
  ...application,
  method: 'PUT',
  path: '/portal/applications/:applicationId/answers',
  summary: "Save a draft's answers, based on its latest answers version",
  body: saveAnswersInputSchema,
  responses: { 200: answersSavedSchema },
});

export const checkApplicationEligibility = defineRoute({
  ...application,
  method: 'POST',
  path: '/portal/applications/:applicationId/eligibility-check',
  summary: "Check a draft's saved answers for eligibility, recording an eligible or stopped result",
  responses: { 200: eligibilitySchema },
});

export const submitApplication = defineRoute({
  ...application,
  method: 'POST',
  path: '/portal/applications/:applicationId/submit',
  summary: "Submit a draft's saved answers, based on its latest answers version",
  body: submitApplicationInputSchema,
  responses: { 200: applicationSchema },
});

export const withdrawApplication = defineRoute({
  ...application,
  method: 'POST',
  path: '/portal/applications/:applicationId/withdraw',
  summary: 'Withdraw a submitted application whose decision is not released',
  responses: { 200: applicationSchema },
});

export const applicationRoutes = {
  listOpenRounds,
  getOpenRound,
  startApplication,
  listApplications,
  getApplication,
  saveApplicationAnswers,
  checkApplicationEligibility,
  submitApplication,
  withdrawApplication,
} as const;
