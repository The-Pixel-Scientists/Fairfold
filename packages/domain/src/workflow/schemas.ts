// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Approval requests and decisions as the inbox reads and makes them (ADR
// 0038). Requests name no tenant, requester, approver or membership: those
// come from the session (rule 6). Reasons are codes from closed lists, with
// no free text. Responses carry ids, codes, counts and times, never the
// subject's own fields, which its module shows through its own projection.
// A request keeps the definition version it was made under (rule 7).

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { MAX_APPROVERS, stepIdSchema, workflowKeySchema } from './definition.ts';

export const requestStatuses = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

export type RequestStatus = (typeof requestStatuses)[number];

export const decisionOutcomes = ['approve', 'reject'] as const;

export type DecisionOutcome = (typeof decisionOutcomes)[number];

export const rejectionReasons = [
  'incorrect_details',
  'missing_evidence',
  'outside_policy',
  'duplicate',
  'other',
] as const;

/** `requester_removed` is set only when removing a membership withdraws its requests. */
export const withdrawalReasons = [
  'no_longer_needed',
  'made_in_error',
  'changes_needed',
  'requester_removed',
] as const;

const rejectionReasonSchema = z.enum(rejectionReasons);
const withdrawalReasonSchema = z.enum(withdrawalReasons);

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const approvalCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** Requests the member may decide, the default, or those they made. Both pending only. */
export const approvalListQuerySchema = z.strictObject({
  view: z.enum(['to_decide', 'mine']).optional(),
  cursor: approvalCursorSchema.optional(),
});

export const approvalParamsSchema = z.strictObject({ requestId: idSchema });

export const rejectionSchema = z.strictObject({ reasonCode: rejectionReasonSchema });

/** A requester withdraws with any code but `requester_removed`. */
export const withdrawalSchema = z.strictObject({
  reasonCode: withdrawalReasonSchema.exclude(['requester_removed']),
});

const time = z.iso.datetime();

export const approvalRequestSchema = z.strictObject({
  id: idSchema,
  definitionKey: workflowKeySchema,
  /** The version it was made under, which it keeps. */
  definitionVersionId: idSchema,
  stepId: stepIdSchema,
  /** The record it is about, in the definition's module. */
  subjectId: idSchema,
  status: z.enum(requestStatuses),
  requiredApprovals: z.int().min(1).max(MAX_APPROVERS),
  /** Distinct members who approved so far. */
  approvals: z.int().min(0).max(MAX_APPROVERS),
  /** The membership that asked. */
  requestedBy: idSchema,
  requestedAt: time,
  /** Overdue once past; it stays pending. */
  dueAt: time.nullable(),
  closedAt: time.nullable(),
  /** Set on a withdrawal. */
  closeReason: withdrawalReasonSchema.nullable(),
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const approvalDecisionSchema = z.strictObject({
  decidedBy: idSchema,
  outcome: z.enum(decisionOutcomes),
  /** Set on a rejection. */
  reasonCode: rejectionReasonSchema.nullable(),
  decidedAt: time,
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/** One request with its decisions, oldest first, and what the reader may do with it now. */
export const approvalRequestDetailSchema = approvalRequestSchema.extend({
  decisions: z.array(approvalDecisionSchema),
  /** checkApprovalDecision() allowed it, and the reader reaches the subject without break-glass. */
  canDecide: z.boolean(),
  /** The reader asked, and it is pending. */
  canWithdraw: z.boolean(),
});

export type ApprovalRequestDetail = z.infer<typeof approvalRequestDetailSchema>;

/** Oldest first. `nextCursor` is null on the last page. */
export const approvalPageSchema = z.strictObject({
  requests: z.array(approvalRequestSchema),
  nextCursor: approvalCursorSchema.nullable(),
});

export type ApprovalPage = z.infer<typeof approvalPageSchema>;
