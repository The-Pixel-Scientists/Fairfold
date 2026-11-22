// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform jobs. A later platform task adds its handler to the list
// below, one line each, in lane order.

import type { JobHandler } from '@pixel-scientists/db/jobs';

import { esignHandlers, type EsignJobDependencies } from '../../platform/documents/esign/index.ts';
import type { FilesJobDependencies } from '../../platform/files/index.ts';
import { defineFanOut, fanOutHandler } from './fan-out.ts';
import { filesHandler } from './files.ts';
import type { RunLogger } from '../job-logger.ts';
import { idempotencyPurgeHandler } from './idempotency-purge.ts';
import { auditPurgeHandler, retentionSweepHandler } from './retention.ts';

/** Tenant queues the hourly fan-out may send to; each is registered in app.job_queue. */
export const fanOutQueue = defineFanOut('platform.fan_out', [
  'platform.idempotency_purge',
  'platform.job_request_expiry',
  'grants.reminder_scan',
]);

/** Migration 0043's daily fan-out, which sends each tenant its files job. */
export const fileFanOutQueue = defineFanOut('platform.file_fan_out', ['platform.file_scan']);

/** The file jobs run only where the worker has the file settings, and the signature jobs where it has a provider. */
export function platformHandlers(
  logger: RunLogger,
  files?: FilesJobDependencies,
  esign?: EsignJobDependencies,
): readonly JobHandler<unknown>[] {
  return [
    fanOutHandler(fanOutQueue, logger),
    idempotencyPurgeHandler(),
    auditPurgeHandler(logger),
    retentionSweepHandler(logger),
    ...(files === undefined ? [] : [fanOutHandler(fileFanOutQueue, logger), filesHandler(files)]),
    ...(esign === undefined ? [] : esignHandlers(esign)),
  ];
}
