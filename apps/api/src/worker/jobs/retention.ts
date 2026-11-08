// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The nightly retention jobs (ADR 0003 "Audit retention", ADR 0009).
//
// The platform job on `platform.audit_purge` sends each active tenant one
// sweep job, from inside that tenant's context, then purges expired
// auth.audit_event rows with no tenant set (ADR 0010 keeps them 12 months).
// One schedule serves both, since the worker keeps one schedule per queue and
// the registered platform queues are these.
//
// The tenant sweep runs in the wrapper's app_worker transaction and takes
// nothing from its payload but ids: the slot (the fan-out job's id) and the
// step of a continuation. A run makes at most MAX_CALLS database calls. If
// work may remain it sends one continuation for the same tenant, and a
// backlog finishes over several jobs. Every call that changes anything leaves
// the audit event its function writes; this file writes none, and logs table
// names and counts only.
//
// A repeat never doubles the work because the database functions are safe to
// repeat: the second delivery of the same {slot, step} finds nothing past its
// date and deletes and counts nothing (the purge records a call that found
// nothing as an event with a count of 0). The singleton key on the sends
// below is not what guarantees this. Migration 0029 registers these
// queues with pg-boss's standard policy, which has no unique index on the
// key, so a duplicate send is stored and run; the key only starts to suppress
// duplicates if a queue policy that indexes it is registered. A duplicate
// costs an extra job and an extra, bounded, chain of continuations, nothing
// more.

import { defineHandler, defineQueue, sendJob, type JobHandler } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { purgeAudit, sweepTenant } from '../../platform/retention/index.ts';
import type { RunLogger } from '../job-logger.ts';
import { defineFanOut, sendToEachTenant } from './fan-out.ts';

/** The most calls to the database functions in one job run. */
export const MAX_CALLS = 20;
/** The longest chain of continuations; what is left waits for the next night. */
export const MAX_STEPS = 50;

/** Migration 0029's tenant queue for the sweep. The step is absent on a night's first job. */
export const retentionSweepQueue = defineQueue(
  'platform.retention_sweep',
  'tenant',
  z.strictObject({ slot: idSchema, step: z.int().min(1).max(MAX_STEPS).optional() }),
);

/** Migration 0029's platform queue, scheduled nightly. */
export const auditPurgeQueue = defineFanOut('platform.audit_purge', [retentionSweepQueue.name]);

export const retentionSweepHandler = (log: RunLogger): JobHandler<unknown> =>
  defineHandler<unknown, (typeof retentionSweepQueue)['data'], 'tenant'>(
    retentionSweepQueue,
    async (trx, job) => {
      const swept = await sweepTenant(trx, MAX_CALLS);
      const queue = retentionSweepQueue.name;
      for (const { policy, table, deleted, anonymised } of swept.applied) {
        log.info(
          { queue, jobId: job.id, policy, table, deleted, anonymised },
          'Retention applied.',
        );
      }
      log.info(
        { queue, jobId: job.id, policy: 'audit', table: 'app.audit_event', deleted: swept.audit },
        'Retention applied.',
      );
      const step = (job.data.step ?? 0) + 1;
      if (swept.remaining && step <= MAX_STEPS) {
        // Keyed so that a queue policy indexing the key suppresses a repeat send.
        await sendJob(trx, retentionSweepQueue, { slot: job.data.slot, step }, job.context, {
          singletonOn: ['slot', 'step'],
        });
      }
    },
  );

export const auditPurgeHandler = (log: RunLogger): JobHandler<unknown> =>
  defineHandler<unknown, (typeof auditPurgeQueue)['data'], 'platform'>(
    auditPurgeQueue,
    async (db, job) => {
      await sendToEachTenant(db, job, log);
      const purged = await purgeAudit(db, MAX_CALLS);
      log.info(
        {
          queue: auditPurgeQueue.name,
          jobId: job.id,
          policy: 'audit',
          table: 'auth.audit_event',
          deleted: purged.deleted,
        },
        'Retention applied.',
      );
    },
  );
