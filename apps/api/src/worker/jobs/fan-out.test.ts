// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineQueue, JobError } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineFanOut, fanOutHandler } from './fan-out.ts';

const sendJob = vi.hoisted(() => vi.fn());

vi.mock('@pixel-scientists/db/jobs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendJob,
  // Three tenants, each in its own transaction.
  forEachTenant: async (_db: unknown, work: (trx: unknown) => Promise<void>) => {
    for (const trx of [{}, {}, {}]) await work(trx);
  },
}));

const target = defineQueue('test_fan_out_target', 'tenant', z.strictObject({ slot: idSchema }));
const other = defineQueue('test_fan_out_other', 'tenant', z.strictObject({ entityId: idSchema }));
const queue = defineFanOut('test_fan_out', [target.name, other.name, 'test_fan_out_unknown']);
const logger = { error: vi.fn() };
const job = (name: string) => ({
  id: crypto.randomUUID(),
  data: { target: name },
  context: { sender: {} as never, requestId: crypto.randomUUID(), causingUserId: null },
});

beforeEach(() => {
  sendJob.mockReset();
  logger.error.mockReset();
});

describe('the fan-out handler', () => {
  it('sends the job id as the slot, keyed on it, once per tenant', async () => {
    const running = job(target.name);
    await fanOutHandler(queue, logger).handle({} as never, running);
    expect(sendJob).toHaveBeenCalledTimes(3);
    expect(sendJob.mock.calls[0]?.slice(1, 3)).toEqual([target, { slot: running.id }]);
    expect(sendJob.mock.calls[0]?.[4]).toEqual({ singletonOn: ['slot'] });
  });

  it('sends each tenant the second target too, and sends none if either target is refused', async () => {
    const second = defineQueue('test_fan_out_second', 'tenant', z.strictObject({ slot: idSchema }));
    const both = defineFanOut('test_fan_out_both', [target.name, second.name, other.name]);
    const running = { ...job(target.name), data: { target: target.name, also: second.name } };
    await fanOutHandler(both, logger).handle({} as never, running);
    expect(sendJob.mock.calls.map((call) => (call[1] as { name: string }).name)).toEqual([
      target.name,
      second.name,
      target.name,
      second.name,
      target.name,
      second.name,
    ]);

    sendJob.mockReset();
    const refused = { ...running, data: { target: target.name, also: other.name } };
    await expect(fanOutHandler(both, logger).handle({} as never, refused)).rejects.toBeInstanceOf(
      JobError,
    );
    expect(sendJob).not.toHaveBeenCalled();
  });

  it('finishes the other tenants when one send fails, then fails with a code only', async () => {
    sendJob
      .mockResolvedValueOnce('1')
      .mockRejectedValueOnce(new Error('relation "tenant_b_secret" failed'))
      .mockResolvedValueOnce('3');
    const result = fanOutHandler(queue, logger).handle({} as never, job(target.name));
    await expect(result).rejects.toMatchObject({ code: 'internal' });
    expect(sendJob).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({ queue: target.name, code: 'internal' });
  });

  it('refuses a target that is undefined or does not take a slot', async () => {
    for (const name of [other.name, 'test_fan_out_unknown']) {
      const result = fanOutHandler(queue, logger).handle({} as never, job(name));
      await expect(result).rejects.toBeInstanceOf(JobError);
    }
    expect(sendJob).not.toHaveBeenCalled();
  });
});
