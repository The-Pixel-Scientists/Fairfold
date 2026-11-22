// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox relay (ADR 0034, ADR 0009 "Processes and scheduling"). A
// scheduled platform job lists the active tenants and, from inside each
// tenant's own transaction, sends that tenant one relay job per consumer. A
// relay job moves one bounded batch of that tenant's events to one consumer,
// in sequence order, and advances the consumer's cursor in the same
// transaction as the sends: a crash or rollback redelivers, never skips. The
// cursor row stays locked for the transaction, so two relays for one tenant
// and consumer take turns. A full batch sends the next relay job.
//
// The relay passes a gap in the numbers without waiting (retention removes old
// events and a restore moves the counter forward, so no earlier number can
// still commit) and logs a `sequence_gap` code with a count. It stops,
// leaving the cursor before it, at an event that does not match its
// contract, and logs a code. Payloads and Postgres messages never reach a
// log.

import {
  defineHandler,
  defineQueue,
  forEachTenant,
  JobError,
  JobSendError,
  sendJob,
  type JobHandler,
  type RunningJob,
} from '@pixel-scientists/db/jobs';
import type { Transaction } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import { EventParseError, parseEvent } from '@pixel-scientists/domain/events';
import { z } from 'zod';

import type { RunLogger } from '../job-logger.ts';
import { consumerCode, consumerHandlers, consumerQueues, type ConsumerCode } from './consumers.ts';
import { ensureCursor, lockCursor, moveCursor, tables } from './cursors.ts';

/** The most events one relay job moves. */
export const BATCH_SIZE = 100;

/** The scheduled platform job; it takes no payload. */
export const relayFanOutQueue = defineQueue(
  'platform.outbox_relay',
  'platform',
  z.strictObject({}),
);

/** One tenant's relay to one consumer. `slot` is the fan-out job's id. */
export const relayQueue = defineQueue(
  'platform.outbox_tenant',
  'tenant',
  z.strictObject({ slot: idSchema, consumer: consumerCode }),
);

type Relay = RunningJob<z.output<(typeof relayQueue)['data']>>;

/** Move one batch for `consumer` in the tenant of `trx`, and return how many events it sent. */
export async function relayBatch(
  trx: Transaction<unknown>,
  consumer: ConsumerCode,
  job: Pick<Relay, 'id' | 'context'>,
  logger: Pick<RunLogger, 'error' | 'info'>,
): Promise<number> {
  await ensureCursor(trx, consumer);
  const cursor = await lockCursor(trx, consumer);
  if (cursor === undefined) throw new JobError('internal');
  const queue = consumerQueues[consumer];
  const rows = await tables(trx)
    .selectFrom('app.event_outbox')
    .selectAll()
    .where('sequence', '>', String(cursor.last))
    .orderBy('sequence')
    .limit(BATCH_SIZE)
    .execute();
  let last = cursor.last;
  let sent = 0;
  let gaps = 0;
  for (const row of rows) {
    const sequence = Number(row.sequence);
    const stop = invalid(row);
    if (stop !== null) {
      logger.error({ queue: queue.name, jobId: job.id, code: stop }, 'The outbox relay stopped.');
      break;
    }
    if (sequence > last + 1) gaps++;
    await sendJob(trx, queue, { eventId: row.id, sequence }, job.context);
    last = sequence;
    sent++;
  }
  if (gaps > 0) {
    logger.info(
      { queue: queue.name, jobId: job.id, code: 'sequence_gap', gaps },
      'The outbox relay passed a gap in the numbers.',
    );
  }
  if (sent > 0) await moveCursor(trx, consumer, last);
  return sent;
}

/** Why an outbox row cannot go to a consumer, as a code, or null if it can. */
function invalid(row: {
  tenant_id: string;
  id: string;
  sequence: string;
  type: string;
  payload: unknown;
  occurred_at: Date;
  request_id: string;
  caused_by: string | null;
}): 'invalid_event' | null {
  try {
    parseEvent({
      id: row.id,
      type: row.type,
      tenantId: row.tenant_id,
      sequence: Number(row.sequence),
      occurredAt: row.occurred_at.toISOString(),
      requestId: row.request_id,
      causedBy: row.caused_by,
      data: row.payload,
    });
    return null;
  } catch (error) {
    if (error instanceof EventParseError) return 'invalid_event';
    throw error;
  }
}

export const relayHandler = (logger: RunLogger): JobHandler<unknown> =>
  defineHandler<unknown, (typeof relayQueue)['data'], 'tenant'>(relayQueue, async (trx, job) => {
    const delivered = await relayBatch(trx, job.data.consumer, job, logger);
    if (delivered === 0) return;
    logger.info(
      { queue: consumerQueues[job.data.consumer].name, jobId: job.id, delivered },
      'Events relayed.',
    );
    if (delivered === BATCH_SIZE) {
      await sendJob(trx, relayQueue, job.data, job.context, { singletonOn: ['slot', 'consumer'] });
    }
  });

/** Sends each active tenant a relay job per consumer; one failed send fails the job after the rest are sent. */
export const relayFanOutHandler = (logger: RunLogger): JobHandler<unknown> =>
  defineHandler<unknown, (typeof relayFanOutQueue)['data'], 'platform'>(
    relayFanOutQueue,
    async (db, job) => {
      let failed = 0;
      await forEachTenant(db, async (trx) => {
        for (const consumer of consumerCode.options) {
          try {
            await sendJob(trx, relayQueue, { slot: job.id, consumer }, job.context, {
              singletonOn: ['slot', 'consumer'],
            });
          } catch (error) {
            failed++;
            const code = error instanceof JobSendError ? error.code : 'internal';
            logger.error(
              { queue: relayQueue.name, jobId: job.id, code },
              'A relay job was not sent.',
            );
          }
        }
      });
      if (failed > 0) throw new JobError('internal');
    },
  );

export const outboxHandlers = (logger: RunLogger): readonly JobHandler<unknown>[] => [
  relayFanOutHandler(logger),
  relayHandler(logger),
  ...consumerHandlers,
];
