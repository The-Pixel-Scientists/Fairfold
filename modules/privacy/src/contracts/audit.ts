// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's audit action codes (architecture rule 4, ADR 0027).
// Values are ids and codes only: a kind, a state, a reason code, a risk
// level, a due date. Never a summary, description, advice or reference.
// Where the event is about a person, their party id travels in the audit
// context as the subject party id, never as a value. The `viewed` codes are
// sensitive reads by staff.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const privacyAuditActions = defineAuditActions('privacy', [
  'privacy.rights_request.created',
  'privacy.rights_request.updated',
  'privacy.rights_request.paused',
  'privacy.rights_request.resumed',
  'privacy.rights_request.extended',
  'privacy.rights_request.closed',
  'privacy.rights_request.viewed',
  'privacy.rights_request.export_started',
  'privacy.rights_request.export_viewed',
  'privacy.rights_request.erasure_started',
  'privacy.request_task.created',
  'privacy.request_task.updated',
  'privacy.request_task.completed',
  'privacy.breach.recorded',
  'privacy.breach.updated',
  'privacy.breach.assessed',
  'privacy.breach.ico_notified',
  'privacy.breach.subjects_notified',
  'privacy.breach.viewed',
  'privacy.dpia.created',
  'privacy.dpia.updated',
  'privacy.dpia.signed_off',
  'privacy.dpia.viewed',
  'privacy.processing_activity.changed',
  'privacy.processor.changed',
  'privacy.consent_history.viewed',
]);

export type PrivacyAuditAction = (typeof privacyAuditActions)[number];
