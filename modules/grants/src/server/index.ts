// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's server entry point (ADR 0016). `grantsHandlers` is for
// apps/api/src/modules.ts alone, which registers the routes.
// `grantsSubjectRules` is for the platform's audit writer alone. `grantsWarehouse`
// feeds the warehouse snapshot. `grantsSubjectData` serves subject access.
// `grantsErasure` serves erasure. `readApplicantContact` is for assure's duplicate flags. `monitoringCounts` serves insight's reports. `sendReleaseEmail` is for the worker's release email job alone. `sendMessageNotification` is for the worker's message notification job alone.

export {
  grantsHandlers,
  grantsResolvers,
  type AssessmentDependencies,
  type ConfigHistoryRow,
  type DecisionDependencies,
  type GrantsContext,
  type GrantsDependencies,
  type MailSender,
  type MessageDependencies,
  type NoteDependencies,
  type NotesPlatform,
} from './routes.ts';
export {
  sendReleaseEmail,
  type ReleaseEmailDependencies,
  type ReleaseEmailJob,
  type ReleaseEmailOutcome,
} from './decisions/job.ts';
export {
  sendMessageNotification,
  type MessageNotificationDependencies,
  type MessageNotificationJob,
  type MessageNotificationOutcome,
} from './messages/job.ts';
export { readApplicantContact, type ApplicantContact } from './applicant-contact.ts';
export { grantsSubjectRules } from './audit.ts';
// For a module that keeps a programme's id, such as impact: whether the tenant has the programme.
export { programmeExists } from './programme/read.ts';
export { monitoringCounts, type MonitoringCounts } from './monitoring/aggregate.ts';
export { grantsWarehouse } from './warehouse.ts';
export { grantsErasure } from './erasure.ts';
export { grantsSubjectData } from './subject-data.ts';
