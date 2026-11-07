// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform jobs. A later platform task adds its handler to the list
// below, one line each, in lane order.

import type { JobHandler, JobLogger } from '@pixel-scientists/db/jobs';

import type { FilesJobDependencies } from '../../platform/files/index.ts';
import { defineFanOut, fanOutHandler } from './fan-out.ts';
import { filesHandler } from './files.ts';
import { idempotencyPurgeHandler } from './idempotency-purge.ts';

/** Tenant queues the fan-out may send to; each is registered in app.job_queue. */
export const fanOutQueue = defineFanOut('platform.fan_out', [
  'platform.idempotency_purge',
  'platform.job_request_expiry',
  'platform.file_scan',
]);

/** The files job runs only where the worker has the file settings. */
export function platformHandlers(
  logger: JobLogger,
  files?: FilesJobDependencies,
): readonly JobHandler<unknown>[] {
  return [
    fanOutHandler(fanOutQueue, logger),
    idempotencyPurgeHandler(),
    ...(files === undefined ? [] : [filesHandler(files)]),
  ];
}
