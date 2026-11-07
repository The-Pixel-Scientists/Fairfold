// SPDX-License-Identifier: AGPL-3.0-or-later
//
// insight's routes (ADR 0004): console only, over the whole tenant, each
// under one of the insight permissions. The acting member always comes from
// the session.
//
// - Reports: members who run reports list and read definitions, run
//   warehouse reports and read their runs; members who set up reports make,
//   change and archive them. Each change records a config version.
// - Equality monitoring reports need their own permission to run, and to
//   read a run back.
// - Publications: prepared, read for review, and marked submitted by the
//   member who submitted them outside the product.
// - The disclosure rule: read, and raised only after step-up.
// - The data contract pages read the registry, not tenant data.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { dataContractListSchema } from './data-contracts.ts';
import {
  reportDefinitionInputSchema,
  reportDefinitionListSchema,
  reportDefinitionSchema,
} from './definitions.ts';
import { disclosureRuleInputSchema, disclosureRuleSchema } from './disclosure.ts';
import { monitoringReportSchema } from './monitoring.ts';
import {
  publicationRunInputSchema,
  publicationRunListSchema,
  publicationRunSchema,
} from './publications.ts';
import { reportResultSchema, reportRunSchema } from './runs.ts';

const base = { audience: 'console', module: 'insight', scope: 'tenant' } as const;
const read = { ...base, permission: 'insight.reports.read' } as const;
const manage = { ...base, permission: 'insight.reports.manage' } as const;
const monitoring = { ...base, permission: 'insight.monitoring.report' } as const;
const publications = { ...base, permission: 'insight.publications.manage' } as const;
const disclosure = { ...base, permission: 'insight.disclosure_rules.manage' } as const;

const report = { params: z.strictObject({ reportId: idSchema }) } as const;
const run = { params: z.strictObject({ runId: idSchema }) } as const;

export const listReportDefinitions = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/reports',
  summary: 'List reports by name, archived reports last',
  responses: { 200: reportDefinitionListSchema },
});

export const getReportDefinition = defineRoute({
  ...read,
  ...report,
  method: 'GET',
  path: '/console/reports/:reportId',
  summary: 'Read a report',
  responses: { 200: reportDefinitionSchema },
});

export const createReportDefinition = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/reports',
  summary: 'Make a warehouse or equality monitoring report',
  body: reportDefinitionInputSchema,
  responses: { 201: reportDefinitionSchema },
});

export const updateReportDefinition = defineRoute({
  ...manage,
  ...report,
  method: 'PUT',
  path: '/console/reports/:reportId',
  summary: "Change a report's name, description, source, measures, groups or filters",
  body: reportDefinitionInputSchema,
  responses: { 200: reportDefinitionSchema },
});

export const archiveReportDefinition = defineRoute({
  ...manage,
  ...report,
  method: 'POST',
  path: '/console/reports/:reportId/archive',
  summary: 'Archive a report, which can then no longer be changed or run',
  responses: { 200: reportDefinitionSchema },
});

export const runReport = defineRoute({
  ...read,
  ...report,
  method: 'POST',
  path: '/console/reports/:reportId/runs',
  summary: 'Run a warehouse report and answer its figures once',
  responses: { 200: reportResultSchema },
});

export const getReportRun = defineRoute({
  ...read,
  ...run,
  method: 'GET',
  path: '/console/report-runs/:runId',
  summary: 'Read who ran a warehouse report, when and with what outcome, without its figures',
  responses: { 200: reportRunSchema },
});

export const runMonitoringReport = defineRoute({
  ...monitoring,
  ...report,
  method: 'POST',
  path: '/console/reports/:reportId/monitoring-runs',
  summary: 'Run an equality monitoring report, with small numbers suppressed',
  responses: { 200: monitoringReportSchema },
});

export const getMonitoringReportRun = defineRoute({
  ...monitoring,
  ...run,
  method: 'GET',
  path: '/console/monitoring-report-runs/:runId',
  summary: 'Read who ran an equality monitoring report, when and with what outcome',
  responses: { 200: reportRunSchema },
});

export const listPublicationRuns = defineRoute({
  ...publications,
  method: 'GET',
  path: '/console/publication-runs',
  summary: 'List publications and annual return figures, newest first',
  responses: { 200: publicationRunListSchema },
});

export const preparePublicationRun = defineRoute({
  ...publications,
  method: 'POST',
  idempotent: true,
  path: '/console/publication-runs',
  summary: 'Prepare a publication or annual return figures for a period, to review',
  body: publicationRunInputSchema,
  responses: { 201: publicationRunSchema },
});

export const getPublicationRun = defineRoute({
  ...publications,
  ...run,
  method: 'GET',
  path: '/console/publication-runs/:runId',
  summary: 'Read a publication run for review',
  responses: { 200: publicationRunSchema },
});

export const markPublicationRunSubmitted = defineRoute({
  ...publications,
  ...run,
  method: 'POST',
  path: '/console/publication-runs/:runId/mark-submitted',
  summary: 'Record that you submitted a prepared publication yourself',
  responses: { 200: publicationRunSchema },
});

export const getDisclosureRule = defineRoute({
  ...disclosure,
  method: 'GET',
  path: '/console/disclosure-rule',
  summary: 'Read the threshold and minimum group that hide small numbers',
  responses: { 200: disclosureRuleSchema },
});

export const updateDisclosureRule = defineRoute({
  ...disclosure,
  method: 'PUT',
  stepUp: true,
  path: '/console/disclosure-rule',
  summary: 'Raise the threshold or minimum group, never below the platform floor',
  body: disclosureRuleInputSchema,
  responses: { 200: disclosureRuleSchema },
});

export const listDataContracts = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/data-contracts',
  summary: "List each module's warehouse data contract, its tables and its columns' classes",
  responses: { 200: dataContractListSchema },
});

export const insightRoutes = {
  listReportDefinitions,
  getReportDefinition,
  createReportDefinition,
  updateReportDefinition,
  archiveReportDefinition,
  runReport,
  getReportRun,
  runMonitoringReport,
  getMonitoringReportRun,
  listPublicationRuns,
  preparePublicationRun,
  getPublicationRun,
  markPublicationRunSubmitted,
  getDisclosureRule,
  updateDisclosureRule,
  listDataContracts,
} as const;
