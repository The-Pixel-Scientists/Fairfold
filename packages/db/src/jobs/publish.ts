// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publishing an event (ADR 0016 "Calls and events", ADR 0034): the one call
// that turns a fact into jobs, one per subscribing module's queue, in the
// publisher's transaction. The outbox write (S12-61) joins it here.

import { randomUUID } from 'node:crypto';

import {
  eventSubscribers,
  parseEvent,
  type EventDefinition,
} from '@pixel-scientists/domain/events';
import type { Transaction } from 'kysely';
import type { z } from 'zod';

import { eventJobQueue } from './queue.ts';
import { currentTenant, JobSendError, sendJob, type JobContext } from './send.ts';

export interface PublishContext extends JobContext {
  /** The membership whose action caused the event, or null for the system (ADR 0034). */
  readonly causedBy: string | null;
}

/**
 * Validate `data` against the event's schema, build its envelope with the
 * tenant read from `trx`, and send it to each subscriber's queue. With no
 * subscribers, nothing is sent.
 */
export async function publish<DB, E extends EventDefinition>(
  trx: Transaction<DB>,
  event: E,
  data: z.input<E['data']>,
  context: PublishContext,
): Promise<void> {
  const tenantId = await currentTenant(trx);
  if (tenantId === null) {
    throw new JobSendError('no_tenant', `${event.name} is published only in a tenant`);
  }
  const envelope = parseEvent({
    id: randomUUID(),
    type: event.name,
    tenantId,
    sequence: null,
    occurredAt: new Date().toISOString(),
    requestId: context.requestId,
    causedBy: context.causedBy,
    data,
  });
  for (const module of eventSubscribers(event.name)) {
    await sendJob(trx, eventJobQueue(module), { event: envelope }, context);
  }
}
