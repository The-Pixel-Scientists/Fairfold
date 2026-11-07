// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring routes (ADR 0032). Monitoring answers are special
// category data, kept apart from the application under their own consent.
//
// The applicant's, under `grants.applications.apply` through
// `own_application`, only once the application is submitted and only while
// its round has a monitoring form (otherwise 404):
// - read the form; answer it once with consent, until the round closes for
//   monitoring; read their own answers; withdraw, which deletes the answers
//   at any time. A changed answer is a withdrawal and a new response.
//   Answering, skipping or withdrawing changes nothing about the
//   application.
// - answering is a PUT to the application's one response, never an
//   idempotent POST: ADR 0028 keeps an unkeyed hash of an idempotent
//   request, and the few possible answer sets could be recovered from it
//   after a withdrawal. Answering once makes a repeat safe without it: a
//   retry after a lost response answers 409 (`alreadyAnswered`), and the
//   portal reads the response to show what was saved.
// - saving, reading and withdrawing record `grants.monitoring.saved`,
//   `.read` and `.withdrawn` with the response and application ids and the
//   privacy notice version only. No answer or field id is ever an audit
//   value, a log field or a problem detail; request bodies are not logged.
//
// Staff, under `grants.programmes.manage`: choose which published form
// version of the round is its monitoring form, separate from the
// application form. The choice is round configuration (rule 10), recorded
// under `grants.round` at the path `monitoringFormVersionId`. No console,
// reviewer or export route carries an answer, or whether anyone answered.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  monitoringAnswerSchema,
  monitoringFormSchema,
  monitoringResponseSchema,
  roundMonitoringFormSchema,
} from './answers.ts';
import { monitoringResponseInputSchema, roundMonitoringFormInputSchema } from './inputs.ts';

const mine = {
  audience: 'portal',
  module: 'grants',
  permission: 'grants.applications.apply',
  scope: 'own_application',
  params: z.strictObject({ applicationId: idSchema }),
} as const;

const setUp = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
  params: z.strictObject({ roundId: idSchema }),
} as const;

export const getMonitoringForm = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications/:applicationId/monitoring-form',
  summary: "Read the equality monitoring form for one of the caller's submitted applications",
  responses: { 200: monitoringFormSchema },
});

export const getMonitoringResponse = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications/:applicationId/monitoring',
  summary: "Read the caller's own equality monitoring answers, if any",
  responses: { 200: monitoringAnswerSchema },
});

export const saveMonitoringResponse = defineRoute({
  ...mine,
  method: 'PUT',
  path: '/portal/applications/:applicationId/monitoring',
  summary: 'Answer the equality monitoring form, with consent',
  body: monitoringResponseInputSchema,
  responses: { 201: monitoringResponseSchema },
});

export const withdrawMonitoringResponse = defineRoute({
  ...mine,
  method: 'DELETE',
  path: '/portal/applications/:applicationId/monitoring',
  summary: "Withdraw consent and delete the caller's equality monitoring answers",
  responses: { 204: null },
});

export const getRoundMonitoringForm = defineRoute({
  ...setUp,
  method: 'GET',
  path: '/console/rounds/:roundId/monitoring-form',
  summary: "Read which published form version is the round's equality monitoring form",
  responses: { 200: roundMonitoringFormSchema },
});

export const setRoundMonitoringForm = defineRoute({
  ...setUp,
  method: 'PUT',
  path: '/console/rounds/:roundId/monitoring-form',
  summary: "Choose the round's equality monitoring form from its published versions, or none",
  body: roundMonitoringFormInputSchema,
  responses: { 200: roundMonitoringFormSchema },
});

export const monitoringRoutes = {
  getMonitoringForm,
  getMonitoringResponse,
  saveMonitoringResponse,
  withdrawMonitoringResponse,
  getRoundMonitoringForm,
  setRoundMonitoringForm,
} as const;
