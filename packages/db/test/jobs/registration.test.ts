// SPDX-License-Identifier: AGPL-3.0-or-later
//
// queueRegistrationProblems(): a queue defined in code but missing from
// app.job_queue, or registered with another kind, fails here rather than at
// the trigger.

import { idSchema } from '@pixel-scientists/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineQueue } from '../../src/jobs/queue.ts';
import { queueRegistrationProblems } from '../../src/jobs/registration.ts';
import { startJobsTest, stopJobsTest, type JobsTest } from './helpers.ts';

const entity = z.strictObject({ entityId: idSchema });
let test: JobsTest;

beforeAll(async () => {
  test = await startJobsTest();
  defineQueue(test.queues.source, 'tenant', entity);
  defineQueue(test.queues.platform, 'platform', entity);
  defineQueue(test.short, 'tenant', entity);
}, 30_000);
afterAll(() => stopJobsTest(test));

describe('queue registration', () => {
  it('finds each defined queue registered with its kind, and names any that is not', async () => {
    const mine = [test.queues.source, test.queues.platform, test.short];
    const before = await queueRegistrationProblems(test.api);
    expect(before.filter((problem) => mine.some((name) => problem.startsWith(name)))).toEqual([]);

    defineQueue(`${test.short}_missing`, 'tenant', entity);
    defineQueue(test.queues.dead, 'platform', entity);
    expect(await queueRegistrationProblems(test.api)).toEqual(
      expect.arrayContaining([
        `${test.short}_missing is not registered in app.job_queue`,
        `${test.queues.dead} is registered as a tenant queue, not platform`,
      ]),
    );
  });
});
