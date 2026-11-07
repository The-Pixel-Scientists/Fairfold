// SPDX-License-Identifier: AGPL-3.0-or-later
//
// insight's audit action codes (architecture rule 4, ADR 0032). Events hold
// ids, codes, versions and counts of cells shown and suppressed: never a
// count of people, a percentage, an answer or a filter's value. None is
// about a person, so none has a subject party id.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const insightAuditActions = defineAuditActions('insight', [
  'insight.report_definition.created',
  'insight.report_definition.changed',
  'insight.report_definition.archived',
  // A warehouse report's run.
  'insight.report.run',
  // An equality monitoring report shown or withheld, and one the run log refused.
  'insight.monitoring_report.run',
  'insight.monitoring_report.refused',
  'insight.publication_run.prepared',
  // A named member's statement that they submitted it themselves.
  'insight.publication_run.submitted',
  'insight.disclosure_rule.changed',
]);

export type InsightAuditAction = (typeof insightAuditActions)[number];
