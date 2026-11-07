// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The worker runner's checks, which refuse before any connection opens.
// Starting it against the database is in test/jobs/worker.test.ts.

import { idSchema } from '@pixel-scientists/domain';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineHandler, type WorkerSetup } from './handler.ts';
import { defineQueue, type Queue } from './queue.ts';
import type { JobSender } from './send.ts';
import { defineSchedule, scheduleProblems, startWorker, type JobSchedule } from './worker.ts';

const entity = z.strictObject({ entityId: idSchema });
const empty = z.strictObject({});
const platform = defineQueue('test_worker_unit_platform', 'platform', empty);
const tenant = defineQueue('test_worker_unit_tenant', 'tenant', empty);
const keyed = defineQueue('test_worker_unit_keyed', 'platform', entity);

const setup: WorkerSetup<unknown> = {
  db: {} as WorkerSetup<unknown>['db'],
  sender: {} as JobSender,
  logger: { error: vi.fn() },
};
const settings = {
  host: 'localhost',
  port: 5432,
  database: 'tps',
  password: 'x',
  applicationName: 't',
};

describe('scheduleProblems', () => {
  it('accepts one schedule per platform queue with a valid payload', () => {
    expect(scheduleProblems([defineSchedule(platform, '0 2 * * *', {})])).toEqual([]);
  });

  it.each<[string, JobSchedule, string]>([
    [
      'a tenant queue',
      { queue: tenant as unknown as Queue<typeof empty, 'platform'>, cron: '0 2 * * *', data: {} },
      'test_worker_unit_tenant is not a platform queue',
    ],
    [
      'a look-alike queue',
      { queue: { ...platform }, cron: '0 2 * * *', data: {} },
      'test_worker_unit_platform was not made by defineQueue()',
    ],
    [
      'a payload that is not ids only',
      { queue: keyed, cron: '0 2 * * *', data: { entityId: 'jane.doe@example.test' } },
      'test_worker_unit_keyed has an invalid payload',
    ],
  ])('refuses %s, naming the queue only', (_, schedule, problem) => {
    expect(scheduleProblems([schedule])).toEqual([problem]);
  });

  it('refuses a queue scheduled twice', () => {
    const schedule = defineSchedule(platform, '0 2 * * *', {});
    expect(scheduleProblems([schedule, schedule])).toEqual([
      'test_worker_unit_platform is scheduled twice',
    ]);
  });
});

describe('startWorker', () => {
  const start = (options: Partial<Parameters<typeof startWorker>[0]>) =>
    startWorker({
      queue: settings,
      setup,
      handlers: [],
      schedules: [],
      onError: vi.fn(),
      ...options,
    });

  it('refuses two handlers for one queue before connecting', async () => {
    const handler = defineHandler(platform, vi.fn());
    await expect(start({ handlers: [handler, handler] })).rejects.toThrow(
      'test_worker_unit_platform has two handlers',
    );
  });

  it('refuses a handler for a queue not made by defineQueue()', async () => {
    const handler = { ...defineHandler(platform, vi.fn()), queue: { ...platform } };
    await expect(start({ handlers: [handler] })).rejects.toThrow('was not made by defineQueue()');
  });

  it('refuses a schedule on a tenant queue before connecting', async () => {
    const schedule = { queue: tenant, cron: '0 2 * * *', data: {} } as unknown as JobSchedule;
    await expect(start({ schedules: [schedule] })).rejects.toThrow('is not a platform queue');
  });
});
