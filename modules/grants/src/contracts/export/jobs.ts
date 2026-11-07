// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Exports made by a job (E10): a saved view as CSV (S12-49) and a board pack
// PDF of chosen applications (S12-78). Both move personal data out of the
// system, so they need `grants.data.export` over the whole tenant and a
// recent sign-in (step-up, ADR 0010). Each request is idempotent, answers 202
// with the job request's id, and records `grants.export.requested` or
// `grants.board_pack.requested` with the request id, the view id or the
// number of applications, never a filter value, a name or a cell.
//
// A request holds ids only. The CSV's columns are never taken from the
// request: the job reads the view when it runs, and the board pack's
// template and layout come from the document templates (S12-12), never from
// the request. The job request (`app.job_request`, S11-67) keeps the
// requester, the permission and the filters and fields left after the
// checks below. Its status is the subject access request's, mirrored below
// because module contracts import only the domain package's first-level
// subpaths: only the member who asked reads it, any other member gets 404,
// and the file is fetched through the file download route.
//
// Who may export (S12-49, S12-78): `grants.data.export` alone is not enough.
// The server answers 403 unless the requester also holds
// EXPORT_READ_PERMISSION in the session's tenant, both when the request is
// made and again when the job runs; a job whose requester has lost it since
// fails with REQUESTER_CANNOT_READ and makes no file. Board pack ids are all
// or none: each must be a submitted application in the session's tenant, and
// a draft's id or another tenant's answers 404, as the triage routes do.
//
// What the jobs hold (S12-49, S12-78):
// - rows and pages are built as the requester sees them, re-checked when the
//   job runs: their scope, the audience projection of each pinned form
//   version, and each field's classification, so special category and
//   `aggregate_only` answers never appear;
// - an unreleased decision appears only where the requester may record
//   decisions;
// - a CSV cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
//   return is escaped, so no spreadsheet runs it as a formula;
// - the output is an `app.file` classified as its most sensitive field and
//   deleted EXPORT_FILE_DAYS after it is made.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import type { Permission } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { idListSchema } from '../triage/schemas.ts';

/** What an export's requester must also hold, on request and when the job runs. */
export const EXPORT_READ_PERMISSION = 'grants.applications.read' satisfies Permission;

/** The failure code of a job whose requester no longer holds EXPORT_READ_PERMISSION. */
export const REQUESTER_CANNOT_READ = 'requester_cannot_read';

/** The most applications one board pack holds. */
export const MAX_BOARD_PACK_APPLICATIONS = 50;

/** How long an export's file is kept. */
export const EXPORT_FILE_DAYS = 7;

/**
 * The same as `jobRequestSchema`, `requestAcceptedSchema` and
 * `requestParamsSchema` in `platform/subject-access` (S11-45); a test keeps
 * them equal. A failure is a code from the worker's closed list, never text.
 */
export const requestAcceptedSchema = z.strictObject({ requestId: idSchema });

export const requestParamsSchema = z.strictObject({ requestId: idSchema });

const requested = { id: idSchema, requestedAt: z.iso.datetime() };

export const jobRequestSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...requested, status: z.enum(['queued', 'running', 'expired']) }),
  z.strictObject({
    ...requested,
    status: z.literal('ready'),
    fileId: idSchema,
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({
    ...requested,
    status: z.literal('failed'),
    failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  }),
]);

export type JobRequest = z.infer<typeof jobRequestSchema>;

export const csvExportRequestSchema = z.strictObject({ viewId: idSchema });

export type CsvExportRequest = z.infer<typeof csvExportRequestSchema>;

export const boardPackRequestSchema = z.strictObject({
  applicationIds: idListSchema(1, MAX_BOARD_PACK_APPLICATIONS),
});

export type BoardPackRequest = z.infer<typeof boardPackRequestSchema>;

const exporter = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.data.export',
  scope: 'tenant',
} as const;

export const requestCsvExport = defineRoute({
  ...exporter,
  method: 'POST',
  path: '/console/csv-exports',
  stepUp: true,
  idempotent: true,
  summary: 'Export a saved view as CSV, made as a file by a job',
  body: csvExportRequestSchema,
  responses: { 202: requestAcceptedSchema },
});

export const readCsvExport = defineRoute({
  ...exporter,
  method: 'GET',
  path: '/console/csv-exports/:requestId',
  summary: 'Read the status of a CSV export you asked for, with its file once ready',
  params: requestParamsSchema,
  responses: { 200: jobRequestSchema },
});

export const requestBoardPack = defineRoute({
  ...exporter,
  method: 'POST',
  path: '/console/board-packs',
  stepUp: true,
  idempotent: true,
  summary: 'Create a board pack PDF of up to 50 applications, made as a file by a job',
  body: boardPackRequestSchema,
  responses: { 202: requestAcceptedSchema },
});

export const readBoardPack = defineRoute({
  ...exporter,
  method: 'GET',
  path: '/console/board-packs/:requestId',
  summary: 'Read the status of a board pack you asked for, with its file once ready',
  params: requestParamsSchema,
  responses: { 200: jobRequestSchema },
});

export const exportJobRoutes = {
  requestCsvExport,
  readCsvExport,
  requestBoardPack,
  readBoardPack,
} as const;
