// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the screens read and send. Defined once, here, so useLoad reads again
// only when a page asks it to. Nothing here names a member, a tenant or an
// actor: the server takes them from the session.

import { call } from '@pixel-scientists/domain/api';

import {
  archiveReportDefinition,
  createReportDefinition,
  getDisclosureRule,
  getPublicationRun,
  getReportDefinition,
  listDataContracts,
  listPublicationRuns,
  listReportDefinitions,
  markPublicationRunSubmitted,
  preparePublicationRun,
  runMonitoringReport,
  runReport,
  updateDisclosureRule,
  updateReportDefinition,
} from '../contracts/index.ts';
import type {
  DisclosureRuleInput,
  PublicationRunInput,
  ReportDefinitionInput,
} from '../contracts/index.ts';

export const loadReports = () => call(listReportDefinitions, {});
export const loadReport = (reportId: string) => call(getReportDefinition, { params: { reportId } });
export const loadPublicationRuns = () => call(listPublicationRuns, {});
export const loadPublicationRun = (runId: string) => call(getPublicationRun, { params: { runId } });
export const loadDisclosureRule = () => call(getDisclosureRule, {});
export const loadDataContracts = () => call(listDataContracts, {});

export const createReport = (body: ReportDefinitionInput) => call(createReportDefinition, { body });
export const updateReport = (reportId: string, body: ReportDefinitionInput) =>
  call(updateReportDefinition, { params: { reportId }, body });
export const archiveReport = (reportId: string) =>
  call(archiveReportDefinition, { params: { reportId } });
export const runWarehouseReport = (reportId: string) => call(runReport, { params: { reportId } });
export const runEqualityReport = (reportId: string) =>
  call(runMonitoringReport, { params: { reportId } });

export const prepareRun = (body: PublicationRunInput, idempotencyKey?: string) =>
  call(preparePublicationRun, { body }, idempotencyKey === undefined ? {} : { idempotencyKey });
export const markSubmitted = (runId: string) =>
  call(markPublicationRunSubmitted, { params: { runId } });
export const changeDisclosureRule = (body: DisclosureRuleInput) =>
  call(updateDisclosureRule, { body });
