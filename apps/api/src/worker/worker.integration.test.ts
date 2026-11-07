// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The worker's fan-out, job audit actor and dead-letter re-send against the
// test database, as app_worker, with two tenants.

import { randomUUID } from 'node:crypto';

import { withTenant, type Transaction } from '@pixel-scientists/db';
import {
  defineQueue,
  sendJob,
  startWorker,
  stopWorker,
  type JobContext,
  type WorkerRunner,
} from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { trustedTenantId } from '../../../../packages/db/src/tenant-context.ts';
import { connectionSettings } from '../../../../packages/db/test/connect.ts';
import { asRoleRolledBack, bossAs, onClient } from '../../../../packages/db/test/jobs/fixtures.ts';
import {
  jobRows,
  startJobsTest,
  stopJobsTest,
  type JobsTest,
} from '../../../../packages/db/test/jobs/helpers.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { recordAudit } from '../audit/writer.ts';
import { resendDeadLetter } from './dead-letter.ts';
import { jobActor } from './job-actor.ts';
import { defineFanOut, fanOutHandler } from './jobs/fan-out.ts';

const entity = z.strictObject({ entityId: idSchema });
const slot = z.strictObject({ slot: idSchema });
let test: JobsTest;
let a: TestTenant;
let b: TestTenant;
const logger = { error: vi.fn() };

beforeAll(async () => {
  test = await startJobsTest();
  [a, b] = [await createTestTenant(), await createTestTenant()];
}, 30_000);
afterAll(() => stopJobsTest(test));

const context = (): JobContext => ({
  sender: test.workerSender,
  requestId: randomUUID(),
  causingUserId: null,
});
const inTenant = <T>(tenant: TestTenant, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
  withTenant(test.worker, trustedTenantId(tenant.id), work);

describe('the platform fan-out', { timeout: 60_000 }, () => {
  it('sends one job per tenant from that tenant, once for a repeated slot', async () => {
    const target = defineQueue(test.short, 'tenant', slot);
    const queue = defineFanOut(test.queues.platform, [test.short]);
    const handler = fanOutHandler(queue, logger);
    const job = { id: randomUUID(), data: { target: test.short }, context: context() };
    await handler.handle(test.worker, job);
    await handler.handle(test.worker, job);

    const rows = await jobRows('name = $1', [target.name]);
    for (const tenant of [a, b]) {
      const own = rows.filter(({ data }) => data['tenantId'] === tenant.id);
      expect(own).toHaveLength(1);
      expect(own[0]?.data['slot']).toBe(job.id);
    }
    // The fan-out sends no job for a tenant from another tenant's context.
    expect(rows.every(({ data }) => typeof data['tenantId'] === 'string')).toBe(true);
  });

  it('is out of reach of app_api: no tenant list and no send to the platform queue', async () => {
    await asRoleRolledBack('app_api', async (client) => {
      await client.query('SAVEPOINT list');
      await expect(client.query('SELECT app.tenant_ids()')).rejects.toMatchObject({
        code: '42501',
      });
      await client.query('ROLLBACK TO SAVEPOINT list');
      const boss = bossAs('app_api');
      await boss.start();
      try {
        await expect(
          boss.send(test.queues.platform, { requestId: randomUUID() }, { db: onClient(client) }),
        ).rejects.toThrow();
      } finally {
        await boss.stop({ graceful: false });
      }
    });
  });
});

describe('a job in a tenant', { timeout: 60_000 }, () => {
  it('records the system, the job id and the originating user, and reads only its tenant', async () => {
    const member = await asMigratorIn(a.id, (client) => addMember(client, a));
    const job = {
      id: randomUUID(),
      context: { ...context(), causingUserId: member },
    };
    const write = (tenant: TestTenant, actorJob: Parameters<typeof jobActor>[0]) =>
      inTenant(tenant, (trx) =>
        recordAudit(trx, jobActor(actorJob), {
          action: 'platform.theme.changed',
          entityId: randomUUID(),
        }),
      );
    await write(a, job);
    await write(b, { id: randomUUID(), context: context() });

    const events = await asMigratorIn(a.id, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        'SELECT actor_kind, actor_id, job_id, origin_membership_id FROM app.audit_event WHERE job_id = $1',
        [job.id],
      );
      return rows;
    });
    expect(events).toEqual([
      { actor_kind: 'system', actor_id: null, job_id: job.id, origin_membership_id: member },
    ]);

    const seen = await inTenant(a, async (trx) => {
      const rows = await (trx as Transaction<{ 'app.audit_event': { tenant_id: string } }>)
        .selectFrom('app.audit_event')
        .select('tenant_id')
        .distinct()
        .execute();
      return rows.map(({ tenant_id }) => tenant_id);
    });
    expect(seen).toEqual([a.id]);
  });

  it('cannot be sent with another tenant named in the payload', async () => {
    const queue = defineQueue(`${test.queues.source}_z`, 'tenant', entity);
    await expect(
      inTenant(a, (trx) =>
        sendJob(trx, queue, { entityId: randomUUID(), tenantId: b.id } as never, context()),
      ),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('dead-letter re-send', { timeout: 60_000 }, () => {
  it('sends the same data again in its own tenant and completes the dead letter', async () => {
    const source = defineQueue(test.queues.source, 'tenant', entity);
    const { host, port, database, password } = connectionSettings('app_queue');
    const runner: WorkerRunner = await startWorker({
      queue: {
        host,
        port,
        database,
        password,
        applicationName: 'tps-api-tests',
        maxConnections: 2,
      },
      setup: { db: test.worker, sender: test.workerSender, logger },
      handlers: [],
      schedules: [],
      onError: vi.fn(),
    });
    const entityId = randomUUID();
    const id = await inTenant(a, (trx) => sendJob(trx, source, { entityId }, context()));
    const boss = bossAs('app_queue');
    await boss.start();
    let deadId = '';
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [job] = await boss.fetch(test.queues.source);
        await boss.fail(test.queues.source, job?.id ?? '', { code: 'test_failure' });
      }
      const [copy] = await boss.fetch(test.queues.dead);
      deadId = copy?.id ?? '';
      // fetch() made it active; put it back so the re-send finds it waiting.
      await boss.retry(test.queues.dead, deadId);
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(id).toEqual(expect.any(String));
    const audit = vi.fn(() => Promise.resolve());
    const resend = (tenant: TestTenant) =>
      resendDeadLetter({
        runner,
        db: test.worker,
        sender: test.workerSender,
        queue: source,
        tenant: trustedTenantId(tenant.id),
        deadLetterId: deadId,
        audit,
      });
    try {
      // Pointed at B, the dead letter of A reads as not found.
      expect(await resend(b)).toBeNull();
      expect(audit).not.toHaveBeenCalled();

      const ids = await resend(a);
      expect(ids).toEqual({ deadLetterId: deadId, newJobId: expect.any(String) as string });
      expect(audit).toHaveBeenCalledOnce();
      const [again] = await jobRows('id = $1', [ids?.newJobId ?? null]);
      expect(again).toMatchObject({ name: test.queues.source, data: { tenantId: a.id, entityId } });
      const [done] = await jobRows('id = $1', [deadId]);
      expect(done?.state).toBe('completed');
    } finally {
      await stopWorker(runner, 5000);
    }
  });
});
