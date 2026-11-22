// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox's consumers (ADR 0034): one closed list. Each code is in the
// CHECK on app.event_cursor.consumer (migration 0098) and has one tenant
// queue, which the relay sends `{ eventId, sequence }` and nothing else.
// Delivery is at least once, so a consumer must be idempotent, and it reads
// the event's current state through its owner's contract. Adding a consumer
// takes a migration for the code and the queues, and a line in each of the
// three places below.

import { defineHandler, defineQueue, type JobHandler, type Queue } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

const delivery = z.strictObject({ eventId: idSchema, sequence: z.int().positive() });

export const consumerCode = z.enum(['probe']);
export type ConsumerCode = z.infer<typeof consumerCode>;

/** The probe receives every event and does nothing with it. */
export const probeQueue = defineQueue('outbox.probe', 'tenant', delivery);

/** Typed over every code, so a code with no queue does not compile. */
export const consumerQueues: Readonly<Record<ConsumerCode, Queue<typeof delivery, 'tenant'>>> = {
  probe: probeQueue,
};

export const consumerHandlers: readonly JobHandler<unknown>[] = [
  defineHandler<unknown, typeof delivery, 'tenant'>(probeQueue, () => Promise.resolve()),
];
