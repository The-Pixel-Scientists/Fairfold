// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the adjustment screens read and send. A grant carries no member,
// user or tenant: the server takes who acts from the session.

import { call } from '@pixel-scientists/domain/api';

import {
  grantAdjustment,
  listRoundAdjustments,
  listSubmissionAdjustments,
  revokeAdjustment,
} from '../../../contracts/index.ts';
import type { GrantAdjustmentInput, RevokeReason } from '../../../contracts/index.ts';

export const loadSubmissionAdjustments = (submissionId: string) =>
  call(listSubmissionAdjustments, { params: { submissionId } });

export const loadRoundAdjustments = (roundId: string) =>
  call(listRoundAdjustments, { params: { roundId } });

/** `idempotencyKey` is the one a failed attempt sent, so trying again cannot give twice. */
export const giveAdjustment = (
  roundId: string,
  body: GrantAdjustmentInput,
  idempotencyKey?: string,
) =>
  call(grantAdjustment, {
    params: { roundId },
    body,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });

export const removeAdjustment = (adjustmentId: string, reasonCode: RevokeReason) =>
  call(revokeAdjustment, { params: { adjustmentId }, body: { reasonCode } });
