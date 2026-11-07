// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's audit action codes (architecture rule 4, ADR 0016).
// Values are ids and codes only: a version number, a respondents setting, a
// spam reason code. Never an answer, a title, the respondent token, an
// idempotency key, a proof or a client address. A signed-in respondent's
// subject party id travels in the audit context (ADR 0027), never as a
// value. An anonymous submission is written by `forms.submit_public_response`
// with the system actor and the request id (ADR 0036). `forms.response.viewed`
// is a sensitive read by staff.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const formsAuditActions = defineAuditActions('forms', [
  'forms.form.created',
  'forms.form.updated',
  'forms.form.retention_changed',
  'forms.form_draft.saved',
  'forms.form_version.published',
  'forms.response.submitted',
  'forms.response.viewed',
  'forms.response.marked_spam',
  'forms.response.unmarked_spam',
]);

export type FormsAuditAction = (typeof formsAuditActions)[number];
