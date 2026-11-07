// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The handler wrapper's parsing and error output, on a platform queue so no
// database is needed. Tenant jobs are in test/jobs/handler.test.ts.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import { EventParseError } from '@pixel-scientists/domain/events';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineHandler, JobError, runJob, type JobLogger, type RunningJob } from './handler.ts';
import { defineQueue } from './queue.ts';
import type { JobSender } from './send.ts';

const queue = defineQueue('test_handler_unit', 'platform', z.strictObject({ entityId: idSchema }));
const SECRET = 'jane.doe@example.test';
const requestId = randomUUID();
const causingUserId = randomUUID();
const payload = { entityId: randomUUID(), requestId, causingUserId };

function setup(logger: JobLogger = { error: vi.fn() }) {
  return { db: {} as Kysely<unknown>, sender: {} as JobSender, logger };
}

function run(fail: (job: RunningJob<{ entityId: string }>) => void, data: unknown = payload) {
  const handler = defineHandler<unknown, typeof queue.data, 'platform'>(queue, (_, job) => {
    fail(job);
    return Promise.resolve();
  });
  return runJob(setup(), handler, { id: 'job-1', data });
}

/** A Postgres error as pg raises it, quoting a value in its message and detail. */
function postgresError(): Error {
  const error = Object.assign(new Error(`duplicate key value violates "${SECRET}"`), {
    code: '23505',
    detail: `Key (email)=(${SECRET}) already exists.`,
    where: `SQL statement "INSERT INTO party.person VALUES ('${SECRET}')"`,
  });
  return new Error(`Wrapped: ${SECRET}`, { cause: error });
}

describe('runJob', () => {
  it('hands the handler its data and context, and completes with no output', async () => {
    let seen: RunningJob<{ entityId: string }> | undefined;
    expect(await run((job) => (seen = job))).toEqual({ id: 'job-1', status: 'completed' });
    expect(seen?.data).toEqual({ entityId: payload.entityId });
    expect(seen?.context).toMatchObject({ requestId, causingUserId });
  });

  it.each([
    ['an unknown key', { ...payload, note: SECRET }],
    ['a tenant on a platform queue', { ...payload, tenantId: randomUUID() }],
    ['a value that is not an id', { ...payload, entityId: SECRET }],
    ['no request id', { entityId: payload.entityId, causingUserId }],
  ])('fails a payload with %s as invalid_payload, never calling the handler', async (_, data) => {
    const handle = vi.fn();
    const result = await run(handle, data);
    expect(handle).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'job-1',
      status: 'failed',
      output: { code: 'invalid_payload', requestId: 'requestId' in data ? requestId : null },
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    ['a JobError', new JobError('not_found'), 'not_found'],
    ['a parse error', new EventParseError('grants.a_fact.v1', ['data.id']), 'invalid_payload'],
    ['a Postgres error that quotes a value', postgresError(), 'internal'],
  ])('fails %s with its code and the request id only', async (_, error, code) => {
    const result = await run(() => {
      throw error;
    });
    expect(result).toEqual({ id: 'job-1', status: 'failed', output: { code, requestId } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('logs the error through the given logger, and survives a logger that throws', async () => {
    const error = postgresError();
    const logger = { error: vi.fn() };
    const handler = defineHandler<unknown, typeof queue.data, 'platform'>(queue, () =>
      Promise.reject(error),
    );
    await runJob(setup(logger), handler, { id: 'job-1', data: payload });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, jobId: 'job-1', requestId, code: 'internal' }),
      'A job failed.',
    );

    const throwing = {
      error: () => {
        throw new Error('logger down');
      },
    };
    const result = await runJob(setup(throwing), handler, { id: 'job-1', data: payload });
    expect(result).toMatchObject({ status: 'failed', output: { code: 'internal' } });
  });
});
