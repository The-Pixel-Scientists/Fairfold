// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publishing an event (ADR 0016 "Calls and events", ADR 0034): the one call
// that turns a fact into an outbox row and jobs, one per subscribing
// module's queue, all in the publisher's transaction. It is the only code
// that writes app.event_outbox.

import { randomUUID } from 'node:crypto';

import {
  eventSubscribers,
  parseEvent,
  type EventDefinition,
  type EventEnvelope,
} from '@pixel-scientists/domain/events';
import { sql, type Transaction } from 'kysely';
import type { z } from 'zod';

import { eventJobQueue } from './queue.ts';
import { currentTenant, JobSendError, sendEventJob, type JobContext } from './send.ts';

export interface PublishContext extends JobContext {
  /** The membership whose action caused the event, or null for the system (ADR 0034). */
  readonly causedBy: string | null;
}

/**
 * Validate `data` against the event's schema, write the event to the
 * tenant's outbox, where the database numbers and times it, and send its
 * envelope to each subscriber's queue. The tenant is read from `trx`. The
 * outbox row locks the tenant's event counter until `trx` ends, so call this
 * as the transaction's last write.
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
  const parsed = parseEvent({
    id: randomUUID(),
    type: event.name,
    tenantId,
    sequence: null,
    occurredAt: new Date().toISOString(),
    requestId: context.requestId,
    causedBy: context.causedBy,
    data,
  });
  const { rows } = await sql<{ sequence: string; occurred_at: Date }>`
    INSERT INTO app.event_outbox (tenant_id, id, type, payload, request_id, caused_by)
    VALUES (${tenantId}, ${parsed.id}, ${parsed.type}, ${JSON.stringify(parsed.data)}::jsonb,
            ${parsed.requestId}, ${parsed.causedBy})
    RETURNING sequence, occurred_at
  `.execute(trx);
  const [row] = rows;
  if (row === undefined) throw new Error(`The outbox write for ${event.name} returned no row.`);
  const envelope: EventEnvelope = {
    ...parsed,
    sequence: Number(row.sequence),
    occurredAt: row.occurred_at.toISOString(),
  };
  for (const module of eventSubscribers(event.name)) {
    await sendEventJob(trx, eventJobQueue(module), envelope, context);
  }
}
