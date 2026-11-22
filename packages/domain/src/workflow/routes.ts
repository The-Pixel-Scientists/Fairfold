// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approvals inbox routes (ADR 0038). The tenant scope is narrowed by
// each subject's module: a member sees and decides a request only if they
// reach its subject through that module's scope rule without break-glass
// (ADR 0037), a request of a module switched off answers 404, and lists and
// counts are filtered the same way. These are the only routes that record a
// decision. Every approve and reject needs step-up, on every definition, and
// takes an idempotency key, since each makes a decision row. Withdrawing is
// the requester's alone and needs no step-up.

import { defineRoute } from '../api/route.ts';
import {
  approvalListQuerySchema,
  approvalPageSchema,
  approvalParamsSchema,
  approvalRequestDetailSchema,
  rejectionSchema,
  withdrawalSchema,
} from './schemas.ts';

const read = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.approvals.read',
  scope: 'tenant',
} as const;

const decide = {
  ...read,
  permission: 'platform.approvals.decide',
  stepUp: true,
  method: 'POST',
  idempotent: true,
  params: approvalParamsSchema,
  responses: { 201: approvalRequestDetailSchema },
} as const;

export const listApprovals = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/approvals',
  summary: 'List pending approval requests you may decide, or those you made',
  query: approvalListQuerySchema,
  responses: { 200: approvalPageSchema },
});

export const readApproval = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/approvals/:requestId',
  summary: 'Read an approval request with its decisions',
  params: approvalParamsSchema,
  responses: { 200: approvalRequestDetailSchema },
});

export const approveRequest = defineRoute({
  ...decide,
  path: '/console/approvals/:requestId/approve',
  summary: 'Approve a request someone else made',
});

export const rejectRequest = defineRoute({
  ...decide,
  path: '/console/approvals/:requestId/reject',
  summary: 'Reject a request someone else made, with a reason',
  body: rejectionSchema,
});

export const withdrawRequest = defineRoute({
  ...read,
  method: 'POST',
  path: '/console/approvals/:requestId/withdraw',
  summary: 'Withdraw a pending request you made, with a reason',
  params: approvalParamsSchema,
  body: withdrawalSchema,
  responses: { 200: approvalRequestDetailSchema },
});

export const approvalRoutes = {
  listApprovals,
  readApproval,
  approveRequest,
  rejectRequest,
  withdrawRequest,
} as const;
