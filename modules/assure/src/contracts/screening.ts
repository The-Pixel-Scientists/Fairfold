// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Screening run routes (ADR 0031). A run screens a party's names against
// the UK sanctions list: an organisation's party and registered names, its
// current contacts and its newest snapshot's officers. Every run names the
// list version it used, so it reads the same however the list is stored.
// A list last checked more than 48 hours before the run gives `stale_list`,
// and no list gives `no_list`: neither is ever shown as "No matches".
//
// - `assure.screening.run` starts a run on demand
//   (`assure.screening_run.started`); the worker records
//   `assure.screening_run.completed` with the status and counts.
// - `assure.screening.read` reads runs.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { dateSchema, timestampSchema } from './schemas.ts';

export const screeningTriggers = ['on_demand', 'submission', 'list_update'] as const;

export const screeningStatuses = [
  'queued',
  'completed',
  'stale_list',
  'no_list',
  'failed',
] as const;

export const screeningStatusSchema = z.enum(screeningStatuses);

/** A version of the sanctions list: when it was published, downloaded and last checked. */
export const listVersionSchema = z.strictObject({
  id: idSchema,
  publishedOn: dateSchema,
  downloadedAt: timestampSchema,
  /** As the run saw it. */
  lastCheckedAt: timestampSchema,
});

/** `list` is null while queued and with `no_list`. */
export const screeningRunSchema = z.strictObject({
  id: idSchema,
  partyId: idSchema,
  trigger: z.enum(screeningTriggers),
  status: screeningStatusSchema,
  list: listVersionSchema.nullable(),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  namesScreened: z.int().min(0),
  matchesRaised: z.int().min(0),
});

export type ScreeningRun = z.infer<typeof screeningRunSchema>;

/** A party's 50 newest runs, newest first. */
export const screeningRunListSchema = z.strictObject({ runs: z.array(screeningRunSchema) });

const staff = { audience: 'console', module: 'assure', scope: 'tenant' } as const;

const party = { params: z.strictObject({ partyId: idSchema }) } as const;

export const startScreeningRun = defineRoute({
  ...staff,
  ...party,
  permission: 'assure.screening.run',
  method: 'POST',
  idempotent: true,
  path: '/console/parties/:partyId/screening-runs',
  summary: 'Screen an organisation or person against the sanctions list now',
  responses: { 201: screeningRunSchema },
});

export const listScreeningRuns = defineRoute({
  ...staff,
  ...party,
  permission: 'assure.screening.read',
  method: 'GET',
  path: '/console/parties/:partyId/screening-runs',
  summary: "List a party's newest screening runs",
  responses: { 200: screeningRunListSchema },
});

export const getScreeningRun = defineRoute({
  ...staff,
  permission: 'assure.screening.read',
  method: 'GET',
  path: '/console/screening-runs/:runId',
  summary: 'Read a screening run with the list version it used',
  params: z.strictObject({ runId: idSchema }),
  responses: { 200: screeningRunSchema },
});

export const screeningRoutes = { startScreeningRun, listScreeningRuns, getScreeningRun } as const;
