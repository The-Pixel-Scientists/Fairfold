// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the approval service queries (migrations 0093 to 0096), as the
// API's role may reach them. An insert names no tenant: it takes it from
// `app.current_tenant_id()`, the transaction's own, and the triggers set
// every column the caller does not choose (ADR 0038).

import type { Generated } from '@pixel-scientists/db';
import type {
  ApprovalDecision,
  ApprovalRequest,
  DecisionOutcome,
  RequestStatus,
} from '@pixel-scientists/domain/workflow';

export type ApprovalTables = {
  'app.workflow_definition_version': {
    tenant_id: string;
    id: Generated<string>;
    definition_id: string;
    version: number;
    document: unknown;
  };
  'app.workflow_definition': { tenant_id: string; id: Generated<string>; key: string };
  'app.approval_request': {
    tenant_id: string;
    id: Generated<string>;
    definition_version_id: string;
    definition_key: Generated<string>;
    step_id: string;
    required_approvals: Generated<number>;
    status: Generated<RequestStatus>;
    requested_by: string;
    requested_at: Generated<Date>;
    due_at: Generated<Date | null>;
    closed_by: Generated<string | null>;
    close_reason: Generated<ApprovalRequest['closeReason']>;
    closed_at: Generated<Date | null>;
  };
  'app.approval_decision': {
    tenant_id: string;
    id: Generated<string>;
    request_id: string;
    decided_by: string;
    outcome: DecisionOutcome;
    reason_code: ApprovalDecision['reasonCode'];
    decided_at: Generated<Date>;
  };
  'app.tenant_module': { module: string; enabled: boolean };
};
