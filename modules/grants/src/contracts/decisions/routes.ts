// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Decision routes (ADR 0004, ADR 0010, ADR 0020), for any round or
// submission in the tenant. Recording a decision and telling the applicant
// are separate steps (architecture rule 8), and each is a named person's
// action (rule 9):
//
// - Members with `grants.decisions.record` list, record, change and preview
//   decisions. Recording sends nothing, and the applicant sees nothing of
//   it. Each records `grants.decision.recorded` or `.changed`, with the
//   outcome and amount. A released decision cannot change: 409.
// - Members with `grants.decisions.release`, having signed in again in the
//   last 5 minutes, release decisions. In one transaction, each chosen
//   decision is released, gets one email row waiting to send with the
//   programme's latest template version for its outcome, and records
//   `grants.decision.released`. After that commits, the request sends up to
//   500 of the round's waiting emails, each recording
//   `grants.decision_email.sent` or `.failed`.
// - Sending again tries the round's emails waiting to send or not sent the
//   same way, recording `grants.decision_email.resent` for each.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  decisionListSchema,
  decisionSchema,
  emailDeliverySchema,
  emailPreviewSchema,
  recordedSchema,
  releaseResultSchema,
} from './answers.ts';
import { bulkDecisionInputSchema, decisionInputSchema, releaseInputSchema } from './inputs.ts';

const staff = { audience: 'console', module: 'grants', scope: 'tenant' } as const;

const record = { ...staff, permission: 'grants.decisions.record' } as const;

const release = { ...staff, permission: 'grants.decisions.release', stepUp: true } as const;

const round = { params: z.strictObject({ roundId: idSchema }) } as const;

const submission = { params: z.strictObject({ submissionId: idSchema }) } as const;

export const listDecisions = defineRoute({
  ...record,
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/decisions',
  summary: "List a round's submissions with mean scores, decisions and the total awarded",
  responses: { 200: decisionListSchema },
});

export const recordDecision = defineRoute({
  ...record,
  ...submission,
  method: 'PUT',
  path: '/console/submissions/:submissionId/decision',
  summary: "Record or change a submission's unreleased decision, without telling the applicant",
  body: decisionInputSchema,
  responses: { 200: decisionSchema },
});

export const recordDecisions = defineRoute({
  ...record,
  ...round,
  method: 'POST',
  path: '/console/rounds/:roundId/decisions',
  summary: "Record or change up to 200 of a round's unreleased decisions, all or none",
  body: bulkDecisionInputSchema,
  responses: { 200: recordedSchema },
});

export const previewDecisionEmail = defineRoute({
  ...record,
  ...submission,
  method: 'GET',
  path: '/console/submissions/:submissionId/decision/email',
  summary: "Preview the email a submission's recorded decision would send",
  responses: { 200: emailPreviewSchema },
});

export const releaseDecisions = defineRoute({
  ...release,
  ...round,
  method: 'POST',
  path: '/console/rounds/:roundId/decisions/release',
  summary: "Release a round's recorded decisions, all or chosen, and email the applicants",
  body: releaseInputSchema,
  responses: { 200: releaseResultSchema },
});

export const sendDecisionEmails = defineRoute({
  ...release,
  ...round,
  method: 'POST',
  path: '/console/rounds/:roundId/decision-emails/send',
  summary: "Send a round's unsent decision emails again, up to 500",
  responses: { 200: emailDeliverySchema },
});

export const decisionRoutes = {
  listDecisions,
  recordDecision,
  recordDecisions,
  previewDecisionEmail,
  releaseDecisions,
  sendDecisionEmails,
} as const;
