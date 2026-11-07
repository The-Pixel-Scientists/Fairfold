// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log routes for tenant admins (architecture rule 4). Reading the
// log is not audited (D23). Search and export take their filters in the
// body. An export is a job that answers 202 and writes
// `platform.audit_log.exported`; only the member who asked reads its status,
// and the file is downloaded through the file download route.

import { defineRoute } from '../../api/route.ts';
import {
  jobRequestSchema,
  requestAcceptedSchema,
  requestParamsSchema,
} from '../subject-access/schemas.ts';
import {
  auditEventPageSchema,
  auditEventQuerySchema,
  auditExportFiltersSchema,
  auditSearchPageSchema,
  auditSearchSchema,
} from './schemas.ts';

const reader = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.audit.read',
  scope: 'tenant',
} as const;

const exporter = { ...reader, permission: 'platform.audit.export' } as const;

/** The MVP1 list, kept for the current screen until it moves to auditEventSearch. */
export const listAuditEvents = defineRoute({
  ...reader,
  method: 'GET',
  path: '/console/audit-events',
  summary: "Read the tenant's audit log, newest first, a page at a time",
  query: auditEventQuerySchema,
  responses: { 200: auditEventPageSchema },
});

/** A read sent as a POST to keep the filters out of URLs; not idempotent, so never retried. */
export const searchAuditEvents = defineRoute({
  ...reader,
  method: 'POST',
  path: '/console/audit-events/search',
  summary: "Search the tenant's audit log, newest first, with the filters in the body",
  body: auditSearchSchema,
  responses: { 200: auditSearchPageSchema },
});

export const exportAuditEvents = defineRoute({
  ...exporter,
  method: 'POST',
  path: '/console/audit-events/exports',
  stepUp: true,
  idempotent: true,
  summary: "Ask for a file of the audit log's events that match the filters, made by a job",
  body: auditExportFiltersSchema,
  responses: { 202: requestAcceptedSchema },
});

/** Only the member who asked reads it; any other member gets 404. */
export const readAuditExport = defineRoute({
  ...exporter,
  method: 'GET',
  path: '/console/audit-events/exports/:requestId',
  summary: 'Read the status of an audit log export you asked for, with its file once ready',
  params: requestParamsSchema,
  responses: { 200: jobRequestSchema },
});

export const auditLogRoutes = {
  listAuditEvents,
  searchAuditEvents,
  exportAuditEvents,
  readAuditExport,
} as const;
