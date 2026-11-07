// SPDX-License-Identifier: AGPL-3.0-or-later

import { scheduleProblems } from '@pixel-scientists/db/jobs';
import { describe, expect, it } from 'vitest';

import { schedules } from '../schedules.ts';
import { BATCH_SIZE, idempotencyPurgeHandler, idempotencyPurgeQueue } from './idempotency-purge.ts';
import { fanOutQueue } from './index.ts';

/** A transaction whose purge function deletes the next count in `counts`. */
function fakeTransaction(counts: number[]) {
  const sizes: unknown[] = [];
  const trx = {
    selectNoFrom: (build: (eb: unknown) => unknown) => {
      build({
        fn: () => ({ as: () => ({}) }),
        val: (value: unknown) => {
          sizes.push(value);
          return value;
        },
      });
      return { executeTakeFirstOrThrow: () => Promise.resolve({ deleted: counts.shift() ?? 0 }) };
    },
  };
  return { trx, sizes };
}

describe('the idempotency purge', () => {
  it('deletes in capped batches until a batch deletes none', async () => {
    const { trx, sizes } = fakeTransaction([BATCH_SIZE, 7, 0]);
    await idempotencyPurgeHandler().handle(trx as never, {} as never);
    expect(sizes).toEqual([BATCH_SIZE, BATCH_SIZE, BATCH_SIZE]);
  });

  it('is a tenant queue named for ADR 0028, reached from the hourly fan-out', () => {
    expect(idempotencyPurgeQueue).toMatchObject({
      name: 'platform.idempotency_purge',
      kind: 'tenant',
    });
    expect(fanOutQueue.data.safeParse({ target: idempotencyPurgeQueue.name }).success).toBe(true);
    expect(scheduleProblems(schedules)).toEqual([]);
    expect(schedules).toContainEqual(
      expect.objectContaining({
        queue: fanOutQueue,
        cron: '0 * * * *',
        data: { target: idempotencyPurgeQueue.name },
      }),
    );
  });
});
