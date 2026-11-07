// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subject access and erasure requests (E3, ADR 0027). Each request is a
// job: it answers 202 with the request's id, and a status route reads it.
// Both requests are idempotent and need step-up. The file a subject access
// request makes is downloaded through the file download route.

import { defineRoute } from '../../api/route.ts';
import { erasureRequestSchema, erasureStatusSchema } from './erasure.ts';
import {
  jobRequestSchema,
  requestAcceptedSchema,
  requestParamsSchema,
  subjectAccessRequestSchema,
} from './schemas.ts';

const subjectAccess = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.subject_access.request',
  scope: 'tenant',
} as const;

const erasure = { ...subjectAccess, permission: 'platform.erasure.request' } as const;

export const requestSubjectAccess = defineRoute({
  ...subjectAccess,
  method: 'POST',
  path: '/console/subject-access-requests',
  stepUp: true,
  idempotent: true,
  summary: "Ask for an export of one person's data, made as a file by a job",
  body: subjectAccessRequestSchema,
  responses: { 202: requestAcceptedSchema },
});

/** Only the member who asked reads it; any other member gets 404. */
export const readSubjectAccessRequest = defineRoute({
  ...subjectAccess,
  method: 'GET',
  path: '/console/subject-access-requests/:requestId',
  summary: 'Read the status of a subject access request you made, with its file once ready',
  params: requestParamsSchema,
  responses: { 200: jobRequestSchema },
});

export const requestErasure = defineRoute({
  ...erasure,
  method: 'POST',
  path: '/console/erasure-requests',
  stepUp: true,
  idempotent: true,
  summary: "Ask to erase one party's personal data, with a reason and confirmation",
  body: erasureRequestSchema,
  responses: { 202: requestAcceptedSchema },
});

/** Members with the erasure permission in the tenant read it; anyone else gets 404. */
export const readErasureRequest = defineRoute({
  ...erasure,
  method: 'GET',
  path: '/console/erasure-requests/:requestId',
  summary: 'Read the status of an erasure request, with counts by table once done',
  params: requestParamsSchema,
  responses: { 200: erasureStatusSchema },
});

export const subjectAccessRoutes = {
  requestSubjectAccess,
  readSubjectAccessRequest,
  requestErasure,
  readErasureRequest,
} as const;
