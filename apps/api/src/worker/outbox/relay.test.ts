// SPDX-License-Identifier: AGPL-3.0-or-later

import { JobError, scheduleProblems } from '@pixel-scientists/db/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendJob = vi.hoisted(() => vi.fn());

vi.mock('@pixel-scientists/db/jobs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendJob,
  // Three tenants, each in its own transaction.
  forEachTenant: async (_db: unknown, work: (trx: unknown) => Promise<void>) => {
    for (const trx of [{}, {}, {}]) await work(trx);
  },
}));

import { consumerCode, consumerQueues } from './consumers.ts';
import { outboxSchedule } from './index.ts';
import { outboxHandlers, relayFanOutHandler, relayFanOutQueue, relayQueue } from './relay.ts';

const logger = { error: vi.fn(), info: vi.fn() };
const job = () => ({
  id: crypto.randomUUID(),
  data: {},
  context: { sender: {} as never, requestId: crypto.randomUUID(), causingUserId: null },
});

beforeEach(() => {
  sendJob.mockReset();
  logger.error.mockReset();
});

describe('the relay queues', () => {
  it('are registered under migration 0098’s names, the fan-out for the platform and the relay for a tenant', () => {
    expect(relayFanOutQueue).toMatchObject({ name: 'platform.outbox_relay', kind: 'platform' });
    expect(relayQueue).toMatchObject({ name: 'platform.outbox_tenant', kind: 'tenant' });
  });

  it('take no tenant, and the relay takes a slot and a consumer in the closed list only', () => {
    const slot = crypto.randomUUID();
    expect(relayQueue.data.safeParse({ slot, consumer: 'probe' }).success).toBe(true);
    for (const bad of [
      { slot, consumer: 'webhooks' },
      { slot, consumer: 'probe', tenantId: crypto.randomUUID() },
      { consumer: 'probe' },
    ]) {
      expect(relayQueue.data.safeParse(bad).success).toBe(false);
    }
    expect(relayFanOutQueue.data.safeParse({ tenantId: crypto.randomUUID() }).success).toBe(false);
  });

  it('have a handler each, and so does every consumer queue', () => {
    const names = outboxHandlers(logger).map(({ queue }) => queue.name);
    expect(names).toEqual(
      expect.arrayContaining([
        relayFanOutQueue.name,
        relayQueue.name,
        ...consumerCode.options.map((code) => consumerQueues[code].name),
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the schedule', () => {
  it('runs the platform fan-out every minute with no payload, and passes the worker’s checks', () => {
    expect(outboxSchedule).toEqual({ queue: relayFanOutQueue, cron: '* * * * *', data: {} });
    expect(scheduleProblems([outboxSchedule])).toEqual([]);
  });
});

describe('the fan-out handler', () => {
  it('sends each tenant one relay job per consumer, keyed on the job id as the slot', async () => {
    const running = job();
    await relayFanOutHandler(logger).handle({} as never, running);
    expect(sendJob).toHaveBeenCalledTimes(3 * consumerCode.options.length);
    expect(sendJob.mock.calls[0]?.slice(1, 3)).toEqual([
      relayQueue,
      { slot: running.id, consumer: 'probe' },
    ]);
    expect(sendJob.mock.calls[0]?.[4]).toEqual({ singletonOn: ['slot', 'consumer'] });
  });

  it('finishes the other tenants when one send fails, then fails with a code only', async () => {
    sendJob
      .mockResolvedValueOnce('1')
      .mockRejectedValueOnce(new Error('relation "tenant_b_secret" failed'))
      .mockResolvedValueOnce('3');
    const result = relayFanOutHandler(logger).handle({} as never, job());
    await expect(result).rejects.toBeInstanceOf(JobError);
    await expect(result).rejects.toMatchObject({ code: 'internal' });
    expect(sendJob).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      queue: relayQueue.name,
      code: 'internal',
    });
  });
});
