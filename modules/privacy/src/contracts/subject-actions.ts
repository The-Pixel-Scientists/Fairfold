// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export and erasure from a rights request (ADR 0027). Each only starts the
// platform's engine (S11-45) for the request's subject; the platform stays
// the one place that knows how to export or erase. Both are POSTs on the
// request, idempotent, under their own step-up permission, and answer 202
// with the platform job request's id, which the request then carries. The
// server checks the request is open and its identity check passed. Erasure
// is one person per request, with the reason `subject_request` set by the
// server and a literal confirmation: never in bulk, on a schedule or
// automatically (rule 9).
//
// `privacy.requests.export` starts the export
// (`privacy.rights_request.export_started`) and reads its status
// (`.export_viewed`, a sensitive read). `privacy.requests.erase` starts the
// erasure (`.erasure_started`) and reads its status.

import { defineRoute } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import {
  erasureStatusSchema,
  jobRequestSchema,
  requestAcceptedSchema,
} from '@pixel-scientists/domain/platform/subject-access';
import { z } from 'zod';

import { requestParamsSchema } from './requests.ts';

/** The only body erasure takes: the subject comes from the request and the reason from the server. */
export const requestErasureInputSchema = z.strictObject({
  confirm: z.literal(true, { error: messages.erasureConfirm }),
});

const onRequest = {
  audience: 'console',
  module: 'privacy',
  scope: 'tenant',
  params: requestParamsSchema,
} as const;

const exporting = { ...onRequest, permission: 'privacy.requests.export' } as const;
const erasing = { ...onRequest, permission: 'privacy.requests.erase' } as const;

export const startRequestExport = defineRoute({
  ...exporting,
  method: 'POST',
  stepUp: true,
  idempotent: true,
  path: '/console/rights-requests/:requestId/export',
  summary: "Start the export of everything held about the request's subject",
  responses: { 202: requestAcceptedSchema },
});

export const getRequestExport = defineRoute({
  ...exporting,
  method: 'GET',
  path: '/console/rights-requests/:requestId/export',
  summary: "Read the status of the request's export, with its file once ready",
  responses: { 200: jobRequestSchema },
});

export const startRequestErasure = defineRoute({
  ...erasing,
  method: 'POST',
  stepUp: true,
  idempotent: true,
  path: '/console/rights-requests/:requestId/erasure',
  summary: "Start erasing the request's subject, after confirming it cannot be undone",
  body: requestErasureInputSchema,
  responses: { 202: requestAcceptedSchema },
});

export const getRequestErasure = defineRoute({
  ...erasing,
  method: 'GET',
  path: '/console/rights-requests/:requestId/erasure',
  summary: "Read the status of the request's erasure, with counts by table once done",
  responses: { 200: erasureStatusSchema },
});

export const subjectActionRoutes = {
  startRequestExport,
  getRequestExport,
  startRequestErasure,
  getRequestErasure,
} as const;
