// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The erasure job (ADR 0009, ADR 0027): the one place a person's data is
// erased, and only for a request a named member made, after step-up. It runs
// in the request's tenant transaction as app_worker and trusts nothing in
// its payload but the request's id. The request holds the party and reason.
//
// The erasure is one unit: every contribution, then the destruction of each
// party's subject key, then `platform.erasure.completed` with counts by
// table. The database writes the ledger row inside each approved function.
// A request that cannot be erased (a requester who is no longer an active
// member holding the permission, an unknown party, a person who still has a
// membership) is checked before anything changes, and is marked failed with
// a code and `platform.erasure.failed`. The erasure itself runs in a
// savepoint: if anything goes wrong in it, all of it is rolled back and the
// request is marked failed with the code `internal` in the same commit, with
// the event. A failed erasure is not retried by the queue; the requester
// asks again, which is safe because nothing was kept. The request stays
// `running` once the erasure is done: the status route reads the completed
// event, since a finished request needs an output file (migration 0029).

import { attempt, type Transaction } from '@pixel-scientists/db';
import { defineQueue, JobError, type JobErrorCode } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import { erasureRequestSchema } from '@pixel-scientists/domain/platform/subject-access';
import type { ErasureTarget } from '@pixel-scientists/party/server';
import { z } from 'zod';

import { recordAudit } from '../../audit/writer.ts';
import { jobActor } from '../../worker/job-actor.ts';
import type { ModuleJob } from '../../worker/registry.ts';
import { runErasure, type Contribution } from './registry.ts';
import { countsAsChanges } from './status.ts';

/** Migration 0029's tenant queue; its payload is the request's id and nothing else. */
export const erasureQueue = defineQueue(
  'platform.erasure',
  'tenant',
  z.strictObject({ jobRequest: idSchema }),
);

export interface ErasureDependencies {
  readonly contributions: readonly Contribution[];
  /** The party module's contract: the named party and its merge set. */
  readonly target: (tx: Transaction<unknown>, partyId: string) => Promise<ErasureTarget | null>;
}

type Tables = Record<string, Record<string, unknown>>;

/** Whether a member of the tenant still holds one of these accounts: they are removed before the person is erased. */
async function holdsMembership(
  tx: Transaction<unknown>,
  accountIds: readonly string[],
): Promise<boolean> {
  if (accountIds.length === 0) return false;
  const held = await tx
    .$extendTables<Tables>()
    .selectFrom('app.membership')
    .select('id')
    .where('user_id', 'in', accountIds)
    .where('status', '<>', 'removed')
    .executeTakeFirst();
  return held !== undefined;
}

/**
 * Whether the member who asked is still an active member of the tenant whose
 * roles give the permission the request was made under (ADR 0009, "Jobs that
 * act for a user"). A queued, retried or resent request never outlives their
 * access.
 */
async function requesterMayErase(
  tx: Transaction<unknown>,
  membershipId: unknown,
  permission: unknown,
): Promise<boolean> {
  if (typeof membershipId !== 'string' || typeof permission !== 'string') return false;
  const member = await tx
    .$extendTables<Tables>()
    .selectFrom('app.membership')
    .select(['status', 'roles'])
    .where('id', '=', membershipId)
    .executeTakeFirst();
  return (
    member?.['status'] === 'active' &&
    (permissionsFor(member['roles'] as string[], 'console') as string[]).includes(permission)
  );
}

export function erasureJob(deps: ErasureDependencies): ModuleJob<(typeof erasureQueue)['data']> {
  return {
    queue: erasureQueue,
    handler: async (trx, job) => {
      const db = trx.$extendTables<Tables>();
      const requestId = job.data.jobRequest;
      const request = await db
        .selectFrom('app.job_request')
        .select(['status', 'filters', 'requested_by', 'permission'])
        .where('id', '=', requestId)
        .where('kind', '=', 'erasure')
        .forUpdate()
        .executeTakeFirst();
      if (!request) throw new JobError('not_found');
      // Settled already, or delivered twice: the first delivery's outcome stands.
      if (request.status !== 'queued') return;

      const actor = jobActor(job);
      const fail = async (code: JobErrorCode, subjectPartyId?: string): Promise<void> => {
        await db
          .updateTable('app.job_request')
          .set({ status: 'running' })
          .where('id', '=', requestId)
          .execute();
        await db
          .updateTable('app.job_request')
          .set({ status: 'failed', failure_code: code })
          .where('id', '=', requestId)
          .execute();
        await recordAudit(trx, actor, {
          action: 'platform.erasure.failed',
          entityId: requestId,
          ...(subjectPartyId === undefined ? {} : { subjectPartyId }),
          changes: { 'app.job_request.failure_code': { after: code } },
        });
      };

      const named = erasureRequestSchema
        .pick({ partyId: true, reason: true })
        .safeParse(request.filters);
      if (!named.success) return fail('invalid_payload');
      const { partyId } = named.data;
      const target = await deps.target(trx, partyId);
      if (target?.kind !== 'person') return fail('not_found');
      if (!(await requesterMayErase(trx, request.requested_by, request.permission))) {
        return fail('precondition_failed', partyId);
      }
      const accounts = target.subjects.flatMap((s) => (s.accountId === null ? [] : [s.accountId]));
      if (await holdsMembership(trx, accounts)) return fail('precondition_failed', partyId);

      const erased = await attempt(trx, async () => {
        await db
          .updateTable('app.job_request')
          .set({ status: 'running' })
          .where('id', '=', requestId)
          .execute();
        const counts = await runErasure(trx, deps.contributions, target.subjects);
        for (const subject of target.subjects) {
          await trx
            .selectNoFrom((eb) =>
              eb.fn('app.destroy_subject_key', [eb.val(subject.partyId)]).as('destroyed'),
            )
            .execute();
        }
        await recordAudit(trx, actor, {
          action: 'platform.erasure.completed',
          entityId: requestId,
          subjectPartyId: partyId,
          changes: countsAsChanges(counts),
        });
      });
      if (!erased) return fail('internal', partyId);
    },
  };
}
