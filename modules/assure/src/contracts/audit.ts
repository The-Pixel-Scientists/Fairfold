// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's audit action codes (architecture rule 4, ADR 0031).
// Values are ids and codes only: a register, an outcome, a reason code,
// counts. Never a name, identifier, answer or finding. Where the event is
// about a person or organisation, its subject party id travels in the
// audit context (ADR 0027), never as a value. The `viewed` codes are
// sensitive reads by staff: a snapshot's officers, and a match with its
// listed entry.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const assureAuditActions = defineAuditActions('assure', [
  'assure.lookup.refresh_requested',
  'assure.lookup.refreshed',
  'assure.lookup.officers_viewed',
  'assure.lookup_officer.linked',
  'assure.screening_run.started',
  'assure.screening_run.completed',
  'assure.screening_match.viewed',
  'assure.screening_match.decided',
  'assure.duplicate_flag.dismissed',
  'assure.checklist.created',
  'assure.checklist.published',
  'assure.checklist_response.saved',
  'assure.visit.recorded',
  'assure.visit.updated',
]);

export type AssureAuditAction = (typeof assureAuditActions)[number];
