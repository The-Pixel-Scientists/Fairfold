// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Published when a request closes as approved or rejected (ADR 0038, ADR
// 0034), not on each decision or a withdrawal. An approval outcome is an
// internal staff step, never held back for release, so its enum may be
// published.

import { z } from 'zod';

import { defineEvent } from '../events/define.ts';
import { idSchema } from '../id.ts';

export const approvalDecided = defineEvent('platform.approval_decided.v1', {
  read: 'platform.approvals.read',
  data: z.strictObject({
    requestId: idSchema,
    outcome: z.enum(['approved', 'rejected']),
    decidedAt: z.iso.datetime(),
  }),
});
