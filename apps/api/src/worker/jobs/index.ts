// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform jobs. A later platform task adds its handler to the list
// below, one line each, in lane order.

import type { JobHandler, JobLogger } from '@pixel-scientists/db/jobs';

import { defineFanOut, fanOutHandler } from './fan-out.ts';
import { idempotencyPurgeHandler } from './idempotency-purge.ts';

/** Tenant queues the fan-out may send to; each is registered in app.job_queue. */
export const fanOutQueue = defineFanOut('platform.fan_out', [
  'platform.idempotency_purge',
  'platform.job_request_expiry',
]);

export function platformHandlers(logger: JobLogger): readonly JobHandler<unknown>[] {
  return [fanOutHandler(fanOutQueue, logger), idempotencyPurgeHandler()];
}
