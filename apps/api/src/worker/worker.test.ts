// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  defineHandler,
  defineQueue,
  scheduleProblems,
  startWorker,
  type JobSchedule,
} from '@pixel-scientists/db/jobs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { jobActor } from './job-actor.ts';
import { jobLogger } from './job-logger.ts';
import { handlerRegistry } from './registry.ts';
import { schedules } from './schedules.ts';
import { shutDown } from './shutdown.ts';

vi.mock('../telemetry/index.ts', () => ({ recordJobFailure: vi.fn() }));

const empty = z.strictObject({});

describe('shutting down', () => {
  it('stops jobs, flushes telemetry, then closes the sender and the pool, whatever fails', async () => {
    const order: string[] = [];
    const step =
      (name: string, fail = false) =>
      () => {
        order.push(name);
        return fail ? Promise.reject(new Error(name)) : Promise.resolve();
      };
    const failed = await shutDown({
      stopJobs: (limit) => {
        expect(limit).toBeGreaterThan(0);
        return step('jobs', true)();
      },
      telemetry: step('telemetry'),
      sender: step('sender'),
      database: step('database'),
    });
    expect(order).toEqual(['jobs', 'telemetry', 'sender', 'database']);
    expect(failed).toBe(1);
  });
});

describe('the handler registry and schedules', () => {
  const logger = { error: vi.fn() };

  it('refuses at start a handler twice, or for a queue not made by defineQueue()', async () => {
    const queue = defineQueue('test_registry_tenant', 'tenant', empty);
    const module = { queue, handler: () => Promise.resolve() };
    const twice = handlerRegistry(logger, [module, module]);
    const options = (handlers: typeof twice) => ({
      queue: { host: 'h', port: 1, database: 'd', password: 'p', applicationName: 'x' },
      setup: {} as never,
      handlers,
      schedules: [],
      onError: vi.fn(),
    });
    await expect(startWorker(options(twice))).rejects.toThrow('has two handlers');
    const fake = { ...queue, name: 'test_registry_fake' };
    const handlers = [defineHandler<unknown, z.ZodObject, 'tenant'>(fake, () => Promise.resolve())];
    await expect(startWorker(options(handlers))).rejects.toThrow('was not made by defineQueue()');
  });

  it('schedules platform queues only, and carries no tenant', () => {
    const tenant = defineQueue('test_schedule_tenant', 'tenant', empty);
    const platform = defineQueue('test_schedule_platform', 'platform', empty);
    const entry = (queue: unknown): JobSchedule =>
      ({ queue, cron: '0 2 * * *', data: {} }) as JobSchedule;
    expect(scheduleProblems([entry(tenant)])).toEqual([
      'test_schedule_tenant is not a platform queue',
    ]);
    expect(scheduleProblems([entry(platform)])).toEqual([]);
    expect(scheduleProblems(schedules)).toEqual([]);
    expect(JSON.stringify(schedules)).not.toMatch(/tenant/i);
  });
});

describe('the job audit actor and logger', () => {
  it('takes the job id and originating user from the job context only', () => {
    const context = { sender: {} as never, requestId: 'r', causingUserId: 'm' };
    expect(jobActor({ id: 'j', context })).toEqual({
      kind: 'job',
      jobId: 'j',
      originMembershipId: 'm',
    });
  });

  it('logs codes, queue names and ids, never the error', () => {
    const error = vi.fn();
    jobLogger({ error }).error(
      {
        err: new Error('relation "secret" does not exist'),
        queue: 'q',
        jobId: 'j',
        code: 'internal',
      },
      'A job failed.',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    expect(error.mock.calls[0]?.[0]).toMatchObject({ queue: 'q', jobId: 'j', code: 'internal' });
  });
});

describe('the code under apps/api', () => {
  it('never imports pg-boss or touches its schema', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !/\.test\.ts$/.test(file),
    );
    const bad = files.filter((file) =>
      /from ['"]pg-boss['"]|\bredrive\(|pgboss\.|boss\.(send|insert)\(/.test(
        readFileSync(`${root}/${file}`, 'utf8'),
      ),
    );
    expect(bad).toEqual([]);
  });
});
