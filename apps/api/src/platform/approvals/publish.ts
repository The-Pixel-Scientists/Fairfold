// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the approval service publishes its one event (ADR 0034): in the
// request's transaction, as the last write, so the jobs commit or roll back
// with the decision. The tenant comes from the transaction and the causing
// member from the session; publish() checks the payload against the event's
// schema, which holds the request id, the outcome and a time, and nothing more.

import { publish, type JobSender } from '@pixel-scientists/db/jobs';
import { approvalDecided } from '@pixel-scientists/domain/workflow';

import type { PublishDecided } from './service.ts';

export const publishApprovalDecided =
  (sender: JobSender): PublishDecided =>
  (tx, data, { requestId, membershipId }) =>
    publish(tx, approvalDecided, data, {
      sender,
      requestId,
      causingUserId: membershipId,
      causedBy: membershipId,
    });
