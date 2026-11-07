// SPDX-License-Identifier: AGPL-3.0-or-later
//
// publish() and event handlers: one job per subscribing module in the
// publisher's transaction, none without subscribers, and each envelope
// parsed with parseEvent() before the handler sees it. events.insight is
// registered by S11-67's migration; until then this test creates it.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import {
  defineEvent,
  defineSubscriptions,
  type EventEnvelope,
} from '@pixel-scientists/domain/events';
import type { Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineEventHandler, runJob } from '../../src/jobs/handler.ts';
import { publish, type PublishContext } from '../../src/jobs/publish.ts';
import { eventJobQueue } from '../../src/jobs/queue.ts';
import { sendEventJob, sendJob } from '../../src/jobs/send.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { withClient } from '../connect.ts';
import { createTestTenant, type TestTenant } from '../tenants.ts';
import { createQueue } from './fixtures.ts';
import { jobRows, startJobsTest, stopJobsTest, type JobsTest } from './helpers.ts';

const QUEUE = 'events.insight';
const read = 'grants.applications.read';
const submitted = defineEvent('grants.jobs_test_submitted.v1', {
  read,
  data: z.strictObject({ applicationId: idSchema }),
});
const unheard = defineEvent('grants.jobs_test_unheard.v1', {
  read,
  data: z.strictObject({ applicationId: idSchema }),
});
defineSubscriptions('insight', [submitted.name]);

let test: JobsTest;
let created = false;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  test = await startJobsTest();
  created = await withClient('migrator', async (client) => {
    const { rowCount } = await client.query('SELECT FROM app.job_queue WHERE name = $1', [QUEUE]);
    if (rowCount !== 0) return false;
    await client.query('BEGIN');
    await createQueue(client, QUEUE, 'tenant');
    await client.query('COMMIT');
    return true;
  });
  [a, b] = [await createTestTenant(), await createTestTenant()];
}, 30_000);
afterAll(async () => {
  await withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await client.query(`DELETE FROM pgboss.job WHERE name = $1 AND data->>'tenantId' = ANY($2)`, [
      QUEUE,
      [a.id, b.id],
    ]);
    if (created) {
      await client.query('DELETE FROM app.job_queue WHERE name = $1', [QUEUE]);
      await client.query('SELECT pgboss.delete_queue($1)', [QUEUE]);
    }
    await client.query('COMMIT');
  });
  await stopJobsTest(test);
});

const context = (): PublishContext => ({
  sender: test.apiSender,
  requestId: randomUUID(),
  causingUserId: randomUUID(),
  causedBy: randomUUID(),
});

function inTenant<T>(tenant: TestTenant, work: (trx: Transaction<unknown>) => Promise<T>) {
  return withTenant(test.api, trustedTenantId(tenant.id), work);
}

const eventJobs = (type: string) =>
  jobRows(`name = $1 AND data->'event'->>'type' = $2`, [QUEUE, type]);

describe('publish', () => {
  it("sends the envelope to each subscriber's queue, with the transaction's tenant", async () => {
    const data = { applicationId: randomUUID() };
    const ctx = context();
    await inTenant(a, (trx) => publish(trx, submitted, data, ctx));
    const rows = (await eventJobs(submitted.name)).filter(
      (row) => (row.data['event'] as EventEnvelope).data['applicationId'] === data.applicationId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({
      tenantId: a.id,
      requestId: ctx.requestId,
      causingUserId: ctx.causingUserId,
      event: {
        id: expect.any(String) as unknown,
        type: submitted.name,
        tenantId: a.id,
        sequence: null,
        occurredAt: expect.any(String) as unknown,
        requestId: ctx.requestId,
        causedBy: ctx.causedBy,
        data,
      },
    });
  });

  it('sends nothing, and does not fail, when no module subscribes', async () => {
    await inTenant(a, (trx) => publish(trx, unheard, { applicationId: randomUUID() }, context()));
    expect(await eventJobs(unheard.name)).toEqual([]);
  });

  it('refuses data the event does not define, and a transaction with no tenant', async () => {
    const data = { applicationId: randomUUID(), note: 'x' } as { applicationId: string };
    await expect(
      inTenant(a, (trx) => publish(trx, submitted, data, context())),
    ).rejects.toMatchObject({ name: 'EventParseError', paths: ['data'] });
    await expect(
      test.api.transaction().execute((trx) => publish(trx, submitted, data, context())),
    ).rejects.toMatchObject({ code: 'no_tenant' });
  });
});

describe('sending on an event queue', () => {
  const envelope = (data: Record<string, unknown>, tenantId = a.id) =>
    ({
      id: randomUUID(),
      type: submitted.name,
      tenantId,
      sequence: null,
      occurredAt: new Date().toISOString(),
      requestId: randomUUID(),
      causedBy: null,
      data,
    }) as EventEnvelope;
  const sentFor = async (applicationId: string) =>
    (await eventJobs(submitted.name)).filter(
      (row) => (row.data['event'] as EventEnvelope).data['applicationId'] === applicationId,
    );

  it('is refused to sendJob(), which leaves event queues to publish()', async () => {
    const data = { applicationId: randomUUID() };
    await expect(
      inTenant(a, (trx) =>
        sendJob(trx, eventJobQueue('insight'), { event: envelope(data) }, context()),
      ),
    ).rejects.toMatchObject({ name: 'JobSendError', code: 'invalid_options' });
    expect(await sentFor(data.applicationId)).toEqual([]);
  });

  it("refuses an envelope for another tenant than the transaction's, and sends nothing", async () => {
    const data = { applicationId: randomUUID() };
    await expect(
      inTenant(a, (trx) =>
        sendEventJob(trx, eventJobQueue('insight'), envelope(data, b.id), context()),
      ),
    ).rejects.toMatchObject({
      name: 'JobSendError',
      code: 'invalid_payload',
      message: expect.stringContaining('event.tenantId') as unknown,
    });
    expect(await sentFor(data.applicationId)).toEqual([]);
  });

  it.each([
    ['free text in place of an envelope', () => ({ email: 'a@example.test', note: 'x' })],
    ['an unknown type', () => ({ ...envelope({ applicationId: randomUUID() }), type: 'x.y.v1' })],
    [
      'data the event does not define',
      () => envelope({ applicationId: randomUUID(), email: 'a@example.test' }),
    ],
  ])('refuses %s as invalid_payload and sends nothing', async (_, event) => {
    await expect(
      inTenant(a, (trx) =>
        sendEventJob(trx, eventJobQueue('insight'), event() as EventEnvelope, context()),
      ),
    ).rejects.toMatchObject({ name: 'JobSendError', code: 'invalid_payload' });
    expect(await jobRows(`name = $1 AND data::text LIKE '%example.test%'`, [QUEUE])).toEqual([]);
  });

  it("sends a valid envelope in the transaction's tenant, as publish() does", async () => {
    const data = { applicationId: randomUUID() };
    const queue = eventJobQueue('insight');
    await inTenant(a, (trx) => sendEventJob(trx, queue, envelope(data), context()));
    expect(await sentFor(data.applicationId)).toHaveLength(1);
  });
});

describe('an event handler', () => {
  const setup = () => ({ db: test.worker, sender: test.workerSender, logger: { error: vi.fn() } });

  async function sentJob(tenant: TestTenant) {
    const data = { applicationId: randomUUID() };
    await inTenant(tenant, (trx) => publish(trx, submitted, data, context()));
    const [row] = (await eventJobs(submitted.name)).filter(
      (job) => (job.data['event'] as EventEnvelope).data['applicationId'] === data.applicationId,
    );
    if (row === undefined) throw new Error('The event was not sent.');
    return { id: randomUUID(), data: row.data };
  }

  it('receives the parsed envelope in its tenant', async () => {
    const handle = vi.fn(() => Promise.resolve());
    const job = await sentJob(a);
    const result = await runJob(setup(), defineEventHandler('insight', handle), job);
    expect(result).toEqual({ id: job.id, status: 'completed' });
    expect(handle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: job.id, data: job.data['event'] }),
    );
  });

  it.each([
    ['an unknown type', (event: EventEnvelope) => ({ ...event, type: 'grants.unknown.v1' })],
    ['an invalid payload', (event: EventEnvelope) => ({ ...event, data: { note: 'x' } })],
    ["another tenant's envelope", (event: EventEnvelope) => ({ ...event, tenantId: b.id })],
  ])('fails %s as invalid_payload', async (_, change) => {
    const handle = vi.fn();
    const job = await sentJob(a);
    const event = change(job.data['event'] as EventEnvelope);
    const result = await runJob(setup(), defineEventHandler('insight', handle), {
      ...job,
      data: { ...job.data, event },
    });
    expect(handle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', output: { code: 'invalid_payload' } });
  });
});
