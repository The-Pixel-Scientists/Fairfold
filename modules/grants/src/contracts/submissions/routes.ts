// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff submission routes (ADR 0004), for any submission in the tenant.
// Members with `grants.applications.read` list and read submissions; each
// read of one records `grants.application.viewed`. Members with
// `grants.applications.triage` move submissions between their round's
// stages, all or none, each moved one recording a stage change and
// `grants.application.stage_changed`. Drafts never appear: a draft's id
// answers 404, as if it did not exist.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { stageMoveResultSchema, submissionPageSchema, submissionSchema } from './answers.ts';
import { stageMoveInputSchema, submissionQuerySchema } from './inputs.ts';

const staff = { audience: 'console', module: 'grants', scope: 'tenant' } as const;

const read = { ...staff, permission: 'grants.applications.read' } as const;

export const listSubmissions = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/submissions',
  summary: 'List submissions, filtered, the latest submitted first, a page at a time',
  query: submissionQuerySchema,
  responses: { 200: submissionPageSchema },
});

export const getSubmission = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/submissions/:submissionId',
  summary: 'Read a submission with its answers, organisation, eligibility checks and history',
  params: z.strictObject({ submissionId: idSchema }),
  responses: { 200: submissionSchema },
});

export const moveSubmissionsToStage = defineRoute({
  ...staff,
  permission: 'grants.applications.triage',
  method: 'POST',
  path: '/console/stages/:stageId/submissions',
  summary: "Move up to 200 of a round's submissions into one of its stages, all or none",
  params: z.strictObject({ stageId: idSchema }),
  body: stageMoveInputSchema,
  responses: { 200: stageMoveResultSchema },
});

export const submissionRoutes = { listSubmissions, getSubmission, moveSubmissionsToStage } as const;
