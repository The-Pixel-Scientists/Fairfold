// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approvals inbox (ADR 0038): the routes that list, read, decide and
// withdraw requests, over the workflow service. The policy has already
// checked the permission, and the step-up for a decision; the service checks
// them again, reaches the subject through its module (ADR 0037) and answers
// 404 for a request the member may not know exists or whose module is off.
// Responses hold ids, codes, counts and times, never a subject's own fields.

import {
  approveRequest,
  listApprovals,
  readApproval,
  rejectRequest,
  withdrawRequest,
} from '@pixel-scientists/domain/workflow';

import { route, type Route } from '../../routes/register.ts';

export { approvalKinds, type ApprovalKind, type ApprovalSubjects, type Reader } from './kinds.ts';
export { publishApprovalDecided } from './publish.ts';
export {
  createWorkflowService,
  type Decision,
  type PublishDecided,
  type RequestWorkflow,
  type WorkflowRequest,
  type WorkflowService,
} from './service.ts';

export const inboxRoutes: readonly Route[] = [
  route(listApprovals, ({ context, input }) =>
    context.workflow.list(input.query.view ?? 'to_decide', input.query.cursor),
  ),
  route(readApproval, ({ context, input }) => context.workflow.read(input.params.requestId)),
  route(
    approveRequest,
    ({ context, input }) => context.workflow.decide(input.params.requestId, { outcome: 'approve' }),
    { replay: ({ context, input }) => context.workflow.state(input.params.requestId) },
  ),
  route(
    rejectRequest,
    ({ context, input }) =>
      context.workflow.decide(input.params.requestId, {
        outcome: 'reject',
        reasonCode: input.body.reasonCode,
      }),
    { replay: ({ context, input }) => context.workflow.state(input.params.requestId) },
  ),
  route(withdrawRequest, ({ context, input }) =>
    context.workflow.withdraw(input.params.requestId, input.body.reasonCode),
  ),
];
