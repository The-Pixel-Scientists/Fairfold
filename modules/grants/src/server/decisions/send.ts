// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Queuing a round's decision emails (ADR 0009, ADR 0020). Releasing or
// resending queues one job per outbox row, in the request's own transaction,
// so the jobs commit or roll back with the release and a slow mail server
// never holds a request up. The platform supplies `queueEmail`; the worker
// sends the mail (job.ts). A job holds the outbox row's id and nothing else.

import type { Tx } from '../programme/tables.ts';
import type { DecisionContext, DecisionDependencies } from './context.ts';

/**
 * Queues one job for each outbox row, as the member whose request it is, and returns the ids of
 * the rows that got one: a row whose job is already waiting gets none.
 */
export async function queueEmails(
  tx: Tx,
  deps: Pick<DecisionDependencies, 'queueEmail'>,
  context: Pick<DecisionContext, 'requestId' | 'membership'>,
  decisionEmailIds: readonly string[],
): Promise<string[]> {
  const by = { requestId: context.requestId, membershipId: context.membership.id };
  const queued: string[] = [];
  for (const id of decisionEmailIds) if (await deps.queueEmail(tx, id, by)) queued.push(id);
  return queued;
}
