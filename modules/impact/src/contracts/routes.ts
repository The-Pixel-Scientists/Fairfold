// SPDX-License-Identifier: AGPL-3.0-or-later
//
// impact's routes (ADR 0004): console only, over the whole tenant, each
// under one of the impact permissions. The acting member always comes from
// the session.
//
// - Members who view outcomes read frameworks, targets, results, learning
//   notes and a framework's progress.
// - Members who set up outcomes make, change and archive frameworks, and
//   set, change and remove targets. Each framework change records a config
//   version.
// - Members who record results add, correct and remove results with their
//   evidence, and add and remove learning notes.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { frameworkInputSchema, frameworkListSchema, frameworkSchema } from './frameworks.ts';
import { learningNoteInputSchema, learningNoteListSchema, learningNoteSchema } from './notes.ts';
import {
  resultInputSchema,
  resultPageSchema,
  resultQuerySchema,
  resultSchema,
  resultUpdateSchema,
} from './results.ts';
import { frameworkSummarySchema, summaryQuerySchema } from './summary.ts';
import {
  targetInputSchema,
  targetListSchema,
  targetSchema,
  targetUpdateSchema,
} from './targets.ts';

const base = { audience: 'console', module: 'impact', scope: 'tenant' } as const;
const read = { ...base, permission: 'impact.frameworks.read' } as const;
const manage = { ...base, permission: 'impact.frameworks.manage' } as const;
const record = { ...base, permission: 'impact.results.manage' } as const;

const framework = { params: z.strictObject({ frameworkId: idSchema }) } as const;
const target = { params: z.strictObject({ targetId: idSchema }) } as const;
const result = { params: z.strictObject({ resultId: idSchema }) } as const;
const note = { params: z.strictObject({ noteId: idSchema }) } as const;

export const listFrameworks = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/outcome-frameworks',
  summary: 'List outcomes frameworks by name, archived frameworks last',
  responses: { 200: frameworkListSchema },
});

export const getFramework = defineRoute({
  ...read,
  ...framework,
  method: 'GET',
  path: '/console/outcome-frameworks/:frameworkId',
  summary: 'Read a framework with its outcomes and indicators',
  responses: { 200: frameworkSchema },
});

export const createFramework = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/outcome-frameworks',
  summary: 'Make an outcomes framework',
  body: frameworkInputSchema,
  responses: { 201: frameworkSchema },
});

export const updateFramework = defineRoute({
  ...manage,
  ...framework,
  method: 'PUT',
  path: '/console/outcome-frameworks/:frameworkId',
  summary: "Change a framework's name, description, outcomes or indicators",
  body: frameworkInputSchema,
  responses: { 200: frameworkSchema },
});

export const archiveFramework = defineRoute({
  ...manage,
  ...framework,
  method: 'POST',
  path: '/console/outcome-frameworks/:frameworkId/archive',
  summary: 'Archive a framework, which then takes no changes, targets or results',
  responses: { 200: frameworkSchema },
});

export const getFrameworkSummary = defineRoute({
  ...read,
  ...framework,
  method: 'GET',
  path: '/console/outcome-frameworks/:frameworkId/summary',
  summary: "Read each indicator's combined results beside its target and baseline",
  query: summaryQuerySchema,
  responses: { 200: frameworkSummarySchema },
});

export const listTargets = defineRoute({
  ...read,
  ...framework,
  method: 'GET',
  path: '/console/outcome-frameworks/:frameworkId/targets',
  summary: "List a framework's targets by indicator and period",
  responses: { 200: targetListSchema },
});

export const createTarget = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/indicator-targets',
  summary: 'Set a target for an indicator over a period, for a programme or overall',
  body: targetInputSchema,
  responses: { 201: targetSchema },
});

export const updateTarget = defineRoute({
  ...manage,
  ...target,
  method: 'PUT',
  path: '/console/indicator-targets/:targetId',
  summary: "Change a target's figure or baseline",
  body: targetUpdateSchema,
  responses: { 200: targetSchema },
});

export const removeTarget = defineRoute({
  ...manage,
  ...target,
  method: 'DELETE',
  path: '/console/indicator-targets/:targetId',
  summary: 'Remove a target',
  responses: { 204: null },
});

export const listResults = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/indicator-results',
  summary: "List a framework's results, latest period first, a page at a time",
  query: resultQuerySchema,
  responses: { 200: resultPageSchema },
});

export const getResult = defineRoute({
  ...read,
  ...result,
  method: 'GET',
  path: '/console/indicator-results/:resultId',
  summary: 'Read a result with its note and evidence',
  responses: { 200: resultSchema },
});

export const createResult = defineRoute({
  ...record,
  method: 'POST',
  idempotent: true,
  path: '/console/indicator-results',
  summary: 'Record a result for an indicator over a period',
  body: resultInputSchema,
  responses: { 201: resultSchema },
});

export const updateResult = defineRoute({
  ...record,
  ...result,
  method: 'PUT',
  path: '/console/indicator-results/:resultId',
  summary: "Correct a result's figure, note or evidence",
  body: resultUpdateSchema,
  responses: { 200: resultSchema },
});

export const removeResult = defineRoute({
  ...record,
  ...result,
  method: 'DELETE',
  path: '/console/indicator-results/:resultId',
  summary: 'Remove a result recorded by mistake',
  responses: { 204: null },
});

export const listLearningNotes = defineRoute({
  ...read,
  ...framework,
  method: 'GET',
  path: '/console/outcome-frameworks/:frameworkId/learning-notes',
  summary: "List a framework's learning notes, newest first",
  responses: { 200: learningNoteListSchema },
});

export const createLearningNote = defineRoute({
  ...record,
  method: 'POST',
  idempotent: true,
  path: '/console/learning-notes',
  summary: 'Add a learning note to a framework or one of its outcomes',
  body: learningNoteInputSchema,
  responses: { 201: learningNoteSchema },
});

export const removeLearningNote = defineRoute({
  ...record,
  ...note,
  method: 'DELETE',
  path: '/console/learning-notes/:noteId',
  summary: 'Remove a learning note',
  responses: { 204: null },
});

export const impactRoutes = {
  listFrameworks,
  getFramework,
  createFramework,
  updateFramework,
  archiveFramework,
  getFrameworkSummary,
  listTargets,
  createTarget,
  updateTarget,
  removeTarget,
  listResults,
  getResult,
  createResult,
  updateResult,
  removeResult,
  listLearningNotes,
  createLearningNote,
  removeLearningNote,
} as const;
