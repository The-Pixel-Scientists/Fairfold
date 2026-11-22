// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Workflow and approval contracts (ADR 0038): the `/workflow` subpath of the
// domain package. The tables are S12-69's: `app.workflow_definition`,
// `app.workflow_definition_version`, `app.approval_request` and
// `app.approval_decision`, each with `tenant_id`, forced row-level security
// and a cross-tenant denial test, composite foreign keys to memberships,
// INSERT and SELECT only on decisions, every column classified internal with
// retention under the tenant's audit rule, and triggers that refuse a
// decision by the requester, a second by the same member, and any actor but
// the session's.

import '../jitless/index.ts';

export { workflowAuditActions, type WorkflowAuditAction } from './audit.ts';
export {
  defineWorkflow,
  MAX_APPROVERS,
  stateIdSchema,
  stepIdSchema,
  tenantVersionProblems,
  workflowConfigEntityType,
  workflowDefinitionProblems,
  workflowDefinitionSchema,
  workflowKeySchema,
  type ApprovalStep,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowTransition,
} from './definition.ts';
export { approvalDecided } from './events.ts';
export {
  approvalRoutes,
  approveRequest,
  listApprovals,
  readApproval,
  rejectRequest,
  withdrawRequest,
} from './routes.ts';
export {
  allowedTransitions,
  approvalsReceived,
  canTransition,
  checkApprovalDecision,
  checkApprovalForAction,
  stepOutcome,
  type ActionRefusal,
  type Answer,
  type DecisionRefusal,
  type DecisionState,
  type LinkedApproval,
  type Member,
  type RequestState,
  type StepOutcome,
  type TransitionRefusal,
} from './rules.ts';
export {
  approvalCursorSchema,
  approvalDecisionSchema,
  approvalListQuerySchema,
  approvalPageSchema,
  approvalParamsSchema,
  approvalRequestDetailSchema,
  approvalRequestSchema,
  decisionOutcomes,
  rejectionReasons,
  rejectionSchema,
  requestStatuses,
  withdrawalReasons,
  withdrawalSchema,
  type ApprovalDecision,
  type ApprovalPage,
  type ApprovalRequest,
  type ApprovalRequestDetail,
  type DecisionOutcome,
  type RequestStatus,
} from './schemas.ts';
