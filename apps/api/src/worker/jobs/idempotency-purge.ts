// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Removes a tenant's expired idempotency keys (ADR 0028, "Expiry"). The
// fan-out sends one job per tenant; this runs in that tenant's transaction as
// app_worker and deletes in bounded batches until a batch deletes none.

import { defineHandler, defineQueue, type JobHandler } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

export const BATCH_SIZE = 10_000;

export const idempotencyPurgeQueue = defineQueue(
  'platform.idempotency_purge',
  'tenant',
  z.strictObject({ slot: idSchema }),
);

export const idempotencyPurgeHandler = (): JobHandler<unknown> =>
  defineHandler<unknown, (typeof idempotencyPurgeQueue)['data'], 'tenant'>(
    idempotencyPurgeQueue,
    async (trx) => {
      for (;;) {
        const { deleted } = await trx
          .selectNoFrom((eb) =>
            eb
              .fn<number>('app.delete_expired_idempotency_keys', [eb.val(BATCH_SIZE)])
              .as('deleted'),
          )
          .executeTakeFirstOrThrow();
        if (deleted === 0) return;
      }
    },
  );
