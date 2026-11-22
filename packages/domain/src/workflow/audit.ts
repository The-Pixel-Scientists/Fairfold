// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approval engine's audit action codes (architecture rule 4, ADR 0038),
// beside the platform's own list. One event per request made, per decision,
// per withdrawal, and per sensitive read where the definition says reading a
// request is one. Values hold ids and codes only: the request, definition
// version and step ids, the outcome, the reason code, and the approvals
// received and required; where the subject is a person, its module supplies
// the subject party id. There is no reason text to keep out of `changes`.

import { defineAuditActions } from '../platform/audit.ts';

export const workflowAuditActions = defineAuditActions('platform', [
  'platform.approval.requested',
  'platform.approval.approved',
  'platform.approval.rejected',
  'platform.approval.withdrawn',
  'platform.approval.viewed',
]);

export type WorkflowAuditAction = (typeof workflowAuditActions)[number];
