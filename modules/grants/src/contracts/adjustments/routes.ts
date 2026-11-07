// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reasonable adjustments (Equality Act 2010), for staff only, under
// `grants.adjustments.manage` in the session's tenant. A deadline extension
// gives an organisation more time in a round; the alternative route lets a
// member start and submit an application for it (applications/assisted.ts).
//
// The rules:
// - granting is idempotent, and the member who grants or removes an
//   adjustment is the session's, never the body's;
// - an extension's closing time is after the round's own and has not
//   passed; it applies through effectiveClosingTime() only;
// - an adjustment is never edited: it is removed, once, with a reason code,
//   and a new one granted;
// - a submission's adjustments are read through its id, so a draft's answer
//   404 as the submissions routes do;
// - granting and removing record `grants.adjustment.granted` and
//   `.revoked` with ids and the kind only. The reason code is special
//   category and never an audit value.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { adjustmentListSchema, adjustmentSchema, submissionAdjustmentsSchema } from './answers.ts';
import { grantAdjustmentInputSchema, revokeAdjustmentInputSchema } from './inputs.ts';

const manage = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.adjustments.manage',
  scope: 'tenant',
} as const;

const round = { ...manage, params: z.strictObject({ roundId: idSchema }) } as const;

export const listRoundAdjustments = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/adjustments',
  summary: "List a round's adjustments, removed ones included, the latest granted first",
  responses: { 200: adjustmentListSchema },
});

export const listSubmissionAdjustments = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/submissions/:submissionId/adjustments',
  summary: 'List the adjustments that apply to a submission, with when it closes',
  params: z.strictObject({ submissionId: idSchema }),
  responses: { 200: submissionAdjustmentsSchema },
});

export const grantAdjustment = defineRoute({
  ...round,
  method: 'POST',
  idempotent: true,
  path: '/console/rounds/:roundId/adjustments',
  summary: 'Give an organisation more time or the alternative route in a round',
  body: grantAdjustmentInputSchema,
  responses: { 201: adjustmentSchema },
});

export const revokeAdjustment = defineRoute({
  ...manage,
  method: 'POST',
  path: '/console/adjustments/:adjustmentId/revoke',
  summary: 'Remove an adjustment, once, with a reason code',
  params: z.strictObject({ adjustmentId: idSchema }),
  body: revokeAdjustmentInputSchema,
  responses: { 200: adjustmentSchema },
});

export const adjustmentRoutes = {
  listRoundAdjustments,
  listSubmissionAdjustments,
  grantAdjustment,
  revokeAdjustment,
} as const;
