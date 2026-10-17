// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's audit action codes (architecture rule 4, ADR 0016).
// Events hold ids, codes and field ids, never personal values. Later grants
// contracts add their codes to this one list.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const grantsAuditActions = defineAuditActions('grants', [
  // Programme set-up (S04-01).
  'grants.programme.created',
  'grants.programme.updated',
  'grants.programme.email_templates_changed',
  'grants.round.created',
  'grants.round.updated',
  'grants.round.stages_changed',
  'grants.stage.rubric_changed',
  // Form versions (S05-06).
  'grants.form_version.created',
  'grants.form_version.updated',
  'grants.form_version.published',
  'grants.form_version.discarded',
  // Applications and submissions (S06-04). Autosaves of a draft are not
  // audited: they are the applicant's own unsubmitted work, and submitting
  // records the result. Each staff read of a submission is.
  'grants.application.created',
  'grants.application.eligibility_checked',
  'grants.application.submitted',
  'grants.application.withdrawn',
  'grants.application.stage_changed',
  'grants.application.viewed',
  // Assessment (S08-04). Saving draft scores is not audited, being the
  // reviewer's unsubmitted work; submitting is.
  'grants.reviewer.added',
  'grants.reviewer.removed',
  'grants.assignment.created',
  'grants.assignment.removed',
  'grants.assignment.conflict_declared',
  'grants.review.submitted',
  // Decisions and their emails (S08-04, ADR 0020).
  'grants.decision.recorded',
  'grants.decision.changed',
  'grants.decision.released',
  'grants.decision_email.sent',
  'grants.decision_email.failed',
  'grants.decision_email.resent',
  // Data out (S10-01): each 360Giving export, and each change to the
  // funder's publisher details.
  'grants.export.downloaded',
  'grants.publisher_setting.changed',
]);

export type GrantsAuditAction = (typeof grantsAuditActions)[number];
