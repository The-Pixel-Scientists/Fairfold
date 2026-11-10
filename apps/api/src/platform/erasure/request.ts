// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for an erasure, and reading how it went (ADR 0027). Only a named
// member with the erasure permission asks, after step-up, with a reason and
// a literal confirmation; the route's schema re-validates both and the acting
// member comes from the session (rules 6 and 9). The request records who
// asked and writes `platform.erasure.requested`, then sends one job holding
// the request's id; the job erases (job.ts). An unknown party, another
// tenant's, an organisation and an erased person all get the same 404, which
// never echoes the id. The status route names no one.

import { sendJob, type JobSender } from '@pixel-scientists/db/jobs';
import { messages, permissionsFor } from '@pixel-scientists/domain/platform';
import type {
  readErasureRequest,
  requestErasure,
} from '@pixel-scientists/domain/platform/subject-access';
import { partyErasureTarget } from '@pixel-scientists/party/server';

import { createJobRequest } from '../../audit/job-request.ts';
import type { TenantTransaction } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler, Replay } from '../../routes/register.ts';
import { erasureQueue } from './job.ts';
import { countsFromChanges } from './status.ts';

type Tables = Record<string, Record<string, unknown>>;

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

/** The columns erased from a person, which classify the request's output. */
const ERASED_FIELDS = [
  'party.person.given_name',
  'party.person.family_name',
  'party.person.email',
  'party.person.phone',
  'party.person.user_id',
];

/**
 * Staff are removed through the membership flow first; this is the quick
 * refusal, the job checks again. A member is staff when their roles give any
 * console permission, which no applicant role does.
 */
async function holdsStaffRole(tx: TenantTransaction, accountIds: readonly string[]) {
  if (accountIds.length === 0) return false;
  const held = await tx
    .$extendTables<Tables>()
    .selectFrom('app.membership')
    .select('roles')
    .where('user_id', 'in', accountIds)
    .where('status', '<>', 'removed')
    .execute();
  return held.some(({ roles }) => permissionsFor(roles as string[], 'console').length > 0);
}

export const requestErasureHandler =
  (jobs: JobSender): Handler<typeof requestErasure> =>
  async ({ tx, context, input }) => {
    const { partyId, reason } = input.body;
    const target = await partyErasureTarget(tx, partyId);
    if (target?.kind !== 'person' || target.erased) throw notFound();
    const accounts = target.subjects.flatMap((s) => (s.accountId === null ? [] : [s.accountId]));
    if (await holdsStaffRole(tx, accounts)) {
      throw new ApiError(409, messages.erasureStaffMember, { reason: 'refused' });
    }
    const requestId = await createJobRequest(
      tx,
      { kind: 'user', membershipId: context.membership.id, requestId: context.requestId },
      {
        kind: 'erasure',
        permission: 'platform.erasure.request',
        filters: { partyId, reason },
        fieldIds: ERASED_FIELDS,
      },
      'platform.erasure.requested',
    );
    await sendJob(
      tx,
      erasureQueue,
      { jobRequest: requestId },
      { sender: jobs, requestId: context.requestId, causingUserId: context.membership.id },
      { singletonOn: ['jobRequest'] },
    );
    return { requestId };
  };

export const readErasureRequestHandler: Handler<typeof readErasureRequest> = async ({
  tx,
  input,
}) => {
  const db = tx.$extendTables<Tables>();
  const { requestId } = input.params;
  const request = await db
    .selectFrom('app.job_request')
    .select(['status', 'failure_code', 'requested_at'])
    .where('id', '=', requestId)
    .where('kind', '=', 'erasure')
    .executeTakeFirst();
  if (!request) throw notFound();
  const id = requestId;
  const requestedAt = (request['requested_at'] as Date).toISOString();
  if (request['status'] === 'failed') {
    return { id, requestedAt, status: 'failed', failureCode: String(request['failure_code']) };
  }
  const completed = await db
    .selectFrom('app.audit_event')
    .select('changes')
    .where('action', '=', 'platform.erasure.completed')
    .where('entity_id', '=', requestId)
    .executeTakeFirst();
  if (completed) {
    const counts = countsFromChanges(completed['changes']);
    if (counts === null) throw new Error('An erasure event holds no counts.');
    return { id, requestedAt, status: 'done', counts };
  }
  return { id, requestedAt, status: request['status'] === 'queued' ? 'queued' : 'running' };
};

/**
 * A retry with the same idempotency key answers the request it made. The
 * stored first answer holds no `id` (the contract's answer is `requestId`), so the request is
 * found by the member who made it and the party it names.
 */
export const replayErasureRequest: Replay<typeof requestErasure> = async ({
  tx,
  context,
  input,
}) => {
  const made = await tx
    .$extendTables<Tables>()
    .selectFrom('app.job_request')
    .select(['id', 'filters'])
    .where('kind', '=', 'erasure')
    .where('requested_by', '=', context.membership.id)
    .orderBy('requested_at', 'desc')
    .execute();
  const same = made.find(
    ({ filters }) => (filters as { partyId?: unknown } | null)?.partyId === input.body.partyId,
  );
  if (!same) throw notFound();
  return { requestId: String(same['id']) };
};
