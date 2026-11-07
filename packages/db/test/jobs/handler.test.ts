// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The handler wrapper against the database: a tenant job runs as app_worker
// in its own tenant and sees no other tenant's rows; through pg-boss, a
// failed job's output holds its code and request id only, even for a
// Postgres error that quotes a value; a job can run twice; and
// forEachTenant() visits each active tenant in its own context.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  defineHandler,
  forEachTenant,
  runJob,
  startHandlers,
  type JobLogger,
} from '../../src/jobs/handler.ts';
import { defineQueue, type Queue } from '../../src/jobs/queue.ts';
import { currentTenant, sendJob } from '../../src/jobs/send.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';
import { bossAs } from './fixtures.ts';
import { jobRows, startJobsTest, stopJobsTest, type JobsTest } from './helpers.ts';

const entity = z.strictObject({ entityId: idSchema });
const SECRET = 'jane.doe@example.test';
let test: JobsTest;
let source: Queue<typeof entity, 'tenant'>;
let short: Queue<typeof entity, 'tenant'>;
let a: TestTenant;
let b: TestTenant;
const logger: JobLogger = { error: vi.fn() };

/** One audit retention rule in `tenant`, committed: a row app_worker may read. */
function addRetentionRule(tenant: TestTenant): Promise<string> {
  return asMigratorIn(tenant.id, async (client) => {
    const by = await addMember(client, tenant);
    return insertRow(client, 'app.retention_policy', {
      tenant_id: tenant.id,
      policy: 'audit',
      days: 400,
      created_by: by,
      updated_by: by,
    });
  });
}

beforeAll(async () => {
  test = await startJobsTest();
  source = defineQueue(test.queues.source, 'tenant', entity);
  short = defineQueue(test.short, 'tenant', entity);
  [a, b] = [await createTestTenant(), await createTestTenant()];
  await addRetentionRule(a);
  await addRetentionRule(b);
}, 30_000);
afterAll(() => stopJobsTest(test));

const setup = () => ({ db: test.worker, sender: test.workerSender, logger });
const payload = (tenant: TestTenant) => ({
  entityId: randomUUID(),
  tenantId: tenant.id,
  requestId: randomUUID(),
  causingUserId: randomUUID(),
});

describe('a tenant job', () => {
  it("runs as app_worker in its own tenant, and sees none of another tenant's rows", async () => {
    const seen: unknown[] = [];
    const handler = defineHandler<unknown, typeof entity, 'tenant'>(source, async (trx) => {
      const { rows } = await sql<{ role: string; tenant: string; owners: string[] | null }>`
        SELECT current_user AS role, app.current_tenant_id() AS tenant,
               (SELECT array_agg(DISTINCT tenant_id) FROM app.retention_policy) AS owners
      `.execute(trx);
      seen.push(rows[0]);
    });
    const result = await runJob(setup(), handler, { id: randomUUID(), data: payload(a) });
    expect(result.status).toBe('completed');
    expect(seen).toEqual([{ role: 'app_worker', tenant: a.id, owners: [a.id] }]);
  });

  it('is never handed to the handler without its tenant', async () => {
    const handle = vi.fn();
    const { entityId, requestId, causingUserId } = payload(a);
    const data = { entityId, requestId, causingUserId };
    const handler = defineHandler<unknown, typeof entity, 'tenant'>(source, handle);
    const result = await runJob(setup(), handler, { id: randomUUID(), data });
    expect(handle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', output: { code: 'invalid_payload' } });
  });

  it('may run twice for the same job id, so handlers are idempotent', async () => {
    const runs: string[] = [];
    const sent: (string | null)[] = [];
    const handler = defineHandler<unknown, typeof entity, 'tenant'>(source, async (trx, job) => {
      runs.push(job.id);
      // A follow-on job keyed on the payload is sent once, however often this runs.
      const options = { singletonOn: ['entityId' as const] };
      sent.push(await sendJob(trx, short, { entityId: job.data.entityId }, job.context, options));
    });
    const job = { id: randomUUID(), data: payload(a) };
    await runJob(setup(), handler, job);
    await runJob(setup(), handler, job);
    expect(runs).toEqual([job.id, job.id]);
    expect(sent).toEqual([expect.any(String), null]);
    const [followOn] = await jobRows('id = $1', [sent[0]]);
    expect(followOn?.data).toMatchObject({
      tenantId: a.id,
      requestId: job.data.requestId,
      causingUserId: job.data.causingUserId,
    });
  });
});

describe('through pg-boss as app_queue', { timeout: 60_000 }, () => {
  it('fails a job with its code and request id only, and completes one with no output', async () => {
    const failing = randomUUID();
    const handler = defineHandler<unknown, typeof entity, 'tenant'>(source, async (trx, job) => {
      // Postgres quotes the value in its message: invalid input syntax for type uuid.
      if (job.data.entityId === failing) await sql`SELECT ${SECRET}::uuid`.execute(trx);
    });
    const context = { sender: test.apiSender, requestId: randomUUID(), causingUserId: null };
    const ids = await withTenant(test.api, trustedTenantId(a.id), async (trx) => [
      await sendJob(trx, source, { entityId: failing }, context),
      await sendJob(trx, source, { entityId: randomUUID() }, context),
    ]);

    const boss = bossAs('app_queue');
    const errors: unknown[] = [];
    boss.on('error', (error) => errors.push(error));
    await boss.start();
    try {
      await startHandlers(boss, setup(), [handler]);
      await vi.waitFor(
        async () => {
          const rows = await jobRows("id = ANY($1) AND state IN ('retry', 'failed', 'completed')", [
            ids,
          ]);
          expect(rows).toHaveLength(2);
        },
        { timeout: 30_000, interval: 500 },
      );
    } finally {
      await boss.stop({ graceful: false });
    }
    const [failed] = await jobRows('id = $1', [ids[0]]);
    const [completed] = await jobRows('id = $1', [ids[1]]);
    expect(failed?.output).toEqual({ code: 'internal', requestId: context.requestId });
    expect(JSON.stringify(failed)).not.toContain(SECRET);
    expect(completed).toMatchObject({ state: 'completed', output: null });
    expect(errors).toEqual([]);
  });

  it('refuses to start handlers on a client that is not app_worker', async () => {
    const work = vi.fn();
    await expect(
      startHandlers({ work }, { ...setup(), db: test.api }, [defineHandler(source, vi.fn())]),
    ).rejects.toThrow('only as app_worker');
    expect(work).not.toHaveBeenCalled();
  });
});

// The shared test database holds every test tenant ever made, so this visits many.
describe('forEachTenant', { timeout: 120_000 }, () => {
  it('runs once in each active tenant, with that tenant set', async () => {
    const visited: (string | null)[] = [];
    await forEachTenant(test.worker, async (trx) => {
      visited.push(await currentTenant(trx));
    });
    expect(visited).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(new Set(visited).size).toBe(visited.length);
    expect(visited).not.toContain(null);
  });

  it('is refused to app_api, which cannot list tenants', async () => {
    await expect(forEachTenant(test.api, () => Promise.resolve())).rejects.toMatchObject({
      code: '42501',
    });
  });
});
