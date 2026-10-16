// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Programme set-up routes (ADR 0004). Staff with `grants.programmes.manage`
// set up any programme in their tenant. Every change writes a configuration
// version and an audit event; the history routes read the versions back.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  emailTemplatesSchema,
  programmeListSchema,
  programmeSchema,
  roundListSchema,
  roundSchema,
  stageListSchema,
  stageSchema,
} from './answers.ts';
import { configHistorySchema } from './config.ts';
import {
  programmeInputSchema,
  roundInputSchema,
  rubricInputSchema,
  stagesInputSchema,
} from './inputs.ts';
import { emailTemplatesInputSchema } from './templates.ts';

const manage = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
} as const;

const programme = { ...manage, params: z.strictObject({ programmeId: idSchema }) } as const;
const round = { ...manage, params: z.strictObject({ roundId: idSchema }) } as const;

export const listProgrammes = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/programmes',
  summary: 'List programmes by title, each with its rounds',
  responses: { 200: programmeListSchema },
});

export const createProgramme = defineRoute({
  ...manage,
  method: 'POST',
  path: '/console/programmes',
  summary: 'Create a programme, with the default email templates',
  body: programmeInputSchema,
  responses: { 201: programmeSchema },
});

export const getProgramme = defineRoute({
  ...programme,
  method: 'GET',
  path: '/console/programmes/:programmeId',
  summary: 'Read a programme',
  responses: { 200: programmeSchema },
});

export const updateProgramme = defineRoute({
  ...programme,
  method: 'PUT',
  path: '/console/programmes/:programmeId',
  summary: "Change a programme's title, summary, description or status",
  body: programmeInputSchema,
  responses: { 200: programmeSchema },
});

export const listRounds = defineRoute({
  ...programme,
  method: 'GET',
  path: '/console/programmes/:programmeId/rounds',
  summary: "List a programme's rounds, the latest opening first",
  responses: { 200: roundListSchema },
});

export const createRound = defineRoute({
  ...programme,
  method: 'POST',
  path: '/console/programmes/:programmeId/rounds',
  summary: "Add a round to a programme, with the default stages, in the tenant's time zone",
  body: roundInputSchema,
  responses: { 201: roundSchema },
});

export const getRound = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId',
  summary: 'Read a round',
  responses: { 200: roundSchema },
});

export const updateRound = defineRoute({
  ...round,
  method: 'PUT',
  path: '/console/rounds/:roundId',
  summary: "Change a round's title, dates, budget, award range or late policy",
  body: roundInputSchema,
  responses: { 200: roundSchema },
});

export const listStages = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/stages',
  summary: "List a round's stages in order, each with its rubric",
  responses: { 200: stageListSchema },
});

export const setStages = defineRoute({
  ...round,
  method: 'PUT',
  path: '/console/rounds/:roundId/stages',
  summary: "Add, rename, remove and reorder a round's stages in one change",
  body: stagesInputSchema,
  responses: { 200: stageListSchema },
});

export const setRubric = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/stages/:stageId/rubric',
  summary: "Replace a stage's rubric criteria, keeping those with an id",
  params: z.strictObject({ stageId: idSchema }),
  body: rubricInputSchema,
  responses: { 200: stageSchema },
});

export const getEmailTemplates = defineRoute({
  ...programme,
  method: 'GET',
  path: '/console/programmes/:programmeId/email-templates',
  summary: "Read the latest version of a programme's outcome email templates",
  responses: { 200: emailTemplatesSchema },
});

export const setEmailTemplates = defineRoute({
  ...programme,
  method: 'PUT',
  path: '/console/programmes/:programmeId/email-templates',
  summary: "Save a programme's outcome email templates, each changed one as a new version",
  body: emailTemplatesInputSchema,
  responses: { 200: emailTemplatesSchema },
});

export const getProgrammeHistory = defineRoute({
  ...programme,
  method: 'GET',
  path: '/console/programmes/:programmeId/history',
  summary: "Read a programme's configuration history, newest first",
  responses: { 200: configHistorySchema },
});

export const getRoundHistory = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/history',
  summary: "Read a round's configuration history, with its stages and rubrics, newest first",
  responses: { 200: configHistorySchema },
});

export const programmeRoutes = {
  listProgrammes,
  createProgramme,
  getProgramme,
  updateProgramme,
  listRounds,
  createRound,
  getRound,
  updateRound,
  listStages,
  setStages,
  setRubric,
  getEmailTemplates,
  setEmailTemplates,
  getProgrammeHistory,
  getRoundHistory,
} as const;
