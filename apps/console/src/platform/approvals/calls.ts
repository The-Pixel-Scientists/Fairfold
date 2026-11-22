// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the approval screens read and send. A decision's reason is sent in the
// body of the request only, never in an address, and is not kept anywhere.

import { ProblemError, call } from '@pixel-scientists/domain/api';
import {
  approveRequest,
  listApprovals,
  readApproval,
  rejectRequest,
  withdrawRequest,
} from '@pixel-scientists/domain/workflow';
import type { ApprovalRequestDetail } from '@pixel-scientists/domain/workflow';
import type { Decision } from '@pixel-scientists/ui';

import { callApi } from '../../api.ts';
import { loadTimeZone } from '../audit-log/loaders.ts';

export const NO_LONGER_AVAILABLE = 'This request is no longer available.';

export const loadInbox = () =>
  Promise.all([callApi(listApprovals, { query: {} }), loadTimeZone()]).then(([page, zone]) => ({
    page,
    zone,
  }));

export const loadMore = (cursor: string) => callApi(listApprovals, { query: { cursor } });

export const readRequest = (requestId: string): Promise<ApprovalRequestDetail> =>
  callApi(readApproval, { params: { requestId } });

export const loadRequest = (requestId: string) =>
  Promise.all([readRequest(requestId), loadTimeZone()]).then(([request, zone]) => ({
    request,
    zone,
  }));

/** Makes one decision. The key is the person's one decision, so a retry is not a second. */
export function send(
  requestId: string,
  decision: Decision,
  idempotencyKey: string,
): Promise<ApprovalRequestDetail> {
  const params = { requestId };
  const options = { idempotencyKey };
  switch (decision.kind) {
    case 'approve':
      return call(approveRequest, { params }, options);
    case 'reject':
      return call(rejectRequest, { params, body: { reasonCode: decision.reasonCode } }, options);
    case 'withdraw':
      return call(withdrawRequest, { params, body: { reasonCode: decision.reasonCode } }, options);
  }
}

/** A request that is gone, or never was, reads the same either way. */
export const isGone = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 404;
