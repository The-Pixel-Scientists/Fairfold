// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight module's published contracts (ADR 0016): report definitions
// and runs, equality monitoring reports with their disclosure rule,
// publication runs, the data contract pages, and audit action codes, safe
// for the browser.

import '@pixel-scientists/domain/jitless';

export { insightAuditActions, type InsightAuditAction } from './audit.ts';
export {
  dataContractList,
  dataContractListSchema,
  type DataContractList,
} from './data-contracts.ts';
export {
  reportDefinitionDiff,
  reportDefinitionInputSchema,
  reportDefinitionListSchema,
  reportDefinitionSchema,
  reportKinds,
  reportOperators,
  type ReportDefinition,
  type ReportDefinitionChange,
  type ReportDefinitionInput,
  type ReportDefinitionList,
  type ReportKind,
} from './definitions.ts';
export {
  appliedDisclosureRuleSchema,
  disclosureFloor,
  disclosureRuleInputSchema,
  disclosureRuleSchema,
  type AppliedDisclosureRule,
  type DisclosureRule,
  type DisclosureRuleInput,
} from './disclosure.ts';
export {
  insightMessages,
  insightRefusals,
  withheldMessage,
  type InsightMessage,
} from './messages.ts';
export {
  monitoringBreakdowns,
  monitoringCellSchema,
  monitoringCodeSchema,
  monitoringFilterSchema,
  monitoringReportSchema,
  type MonitoringBreakdown,
  type MonitoringCell,
  type MonitoringFilter,
  type MonitoringReport,
} from './monitoring.ts';
export {
  publicationKinds,
  publicationRunInputSchema,
  publicationRunListSchema,
  publicationRunSchema,
  publicationStates,
  type PublicationKind,
  type PublicationRun,
  type PublicationRunInput,
  type PublicationRunList,
  type PublicationState,
} from './publications.ts';
export {
  archiveReportDefinition,
  createReportDefinition,
  getDisclosureRule,
  getMonitoringReportRun,
  getPublicationRun,
  getReportDefinition,
  getReportRun,
  insightRoutes,
  listDataContracts,
  listPublicationRuns,
  listReportDefinitions,
  markPublicationRunSubmitted,
  preparePublicationRun,
  runMonitoringReport,
  runReport,
  updateDisclosureRule,
  updateReportDefinition,
} from './routes.ts';
export {
  MAX_REPORT_ROWS,
  reportResultSchema,
  reportRunOutcomes,
  reportRunSchema,
  type ReportResult,
  type ReportRun,
  type ReportRunOutcome,
} from './runs.ts';
