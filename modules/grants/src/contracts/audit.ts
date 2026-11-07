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
  // A member submitted it for the applicant through the alternative route
  // (S11-54), recorded beside `.submitted` with the member as the actor.
  'grants.application.submitted_on_behalf',
  // A member saved answers in an assisted draft (S11-54). Unlike an
  // autosave this is audited, as staff write in the applicant's name: the
  // answers version and changed field ids, never a value.
  'grants.application.answers_saved_on_behalf',
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
  // Reasonable adjustments (S11-54): ids and the kind only, never the reason
  // code, which is special category.
  'grants.adjustment.granted',
  'grants.adjustment.revoked',
  // Equality monitoring (ADR 0032): the response and application ids and the
  // privacy notice version only, never an answer or a field id. `read` is the
  // applicant viewing their own answers and `disclosed` a rights-request
  // read, both sensitive reads. Shown only to members who also hold
  // `grants.monitoring.disclose`.
  'grants.monitoring.saved',
  'grants.monitoring.read',
  'grants.monitoring.withdrawn',
  'grants.monitoring.disclosed',
  // A round's reminder setting (S11-54). Reminders sent are kept in their own
  // outbox, not the audit log.
  'grants.reminder_setting.updated',
  // Notes and messages (S12-02). The entity is the application, so the
  // subject is its applicant (ADR 0027); the note or message id, the side and
  // counts go in the changes, never a body or a name. `messages_viewed` is
  // each staff read of a thread, a sensitive read; the applicant's reads of
  // their own are not.
  'grants.application.note_added',
  'grants.application.message_sent',
  'grants.application.messages_viewed',
]);

export type GrantsAuditAction = (typeof grantsAuditActions)[number];
