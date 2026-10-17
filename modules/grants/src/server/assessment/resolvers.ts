// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The scope rule of the reviewer's routes (ADR 0004). A false answer is a
// 404, exactly as a record that does not exist reads, so a reviewer learns
// nothing about other reviewers' assignments, unassigned submissions, or
// an assignment they declared a conflict on. The membership is the session's
// own. The list route has no assignment in its path and filters in its handler.

import { getReview } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { assessmentDb } from './tables.ts';

export interface ScopeCheck {
  readonly tx: Tx;
  readonly membershipId: string;
  readonly input: { readonly params: unknown };
}

export const assessmentResolvers = {
  /** An assignment to the caller's membership whose status is not `conflicted`. */
  assigned_review: async ({ tx, membershipId, input }: ScopeCheck): Promise<boolean> => {
    if (input.params === undefined) return true;
    const params = getReview.params.safeParse(input.params);
    if (!params.success) return false;
    const row = await assessmentDb(tx)
      .selectFrom('grants.assignment')
      .select('id')
      .where('id', '=', params.data.assignmentId)
      .where('reviewer_membership_id', '=', membershipId)
      .where('status', '<>', 'conflicted')
      .executeTakeFirst();
    return row !== undefined;
  },
};
