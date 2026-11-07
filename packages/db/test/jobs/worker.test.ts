// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The worker runner against the database: it connects as app_queue with
// supervise and schedule on, hands each job to its handler through the
// wrapper as app_worker, keeps exactly the schedules it is given, and
// forwards a cron occurrence to a platform queue but never to a tenant
// queue (migration 0036). A dead letter is read only in its own tenant,
// sent again from there and then completed.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { completeDeadLetter, readDeadLetter } from '../../src/jobs/dead-letter.ts';
import { defineHandler, type JobLogger } from '../../src/jobs/handler.ts';
import { defineQueue, type Queue } from '../../src/jobs/queue.ts';
import { sendJob } from '../../src/jobs/send.ts';
import { defineSchedule, startWorker, stopWorker } from '../../src/jobs/worker.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { connectionSettings, withClient } from '../connect.ts';
import { createTestTenant, type TestTenant } from '../tenants.ts';
import { asRoleRolledBack, bossAs, REFUSED, tryInsertJob } from './fixtures.ts';
import { jobRows, startJobsTest, stopJobsTest, type JobsTest } from './helpers.ts';

const CRON_QUEUE = '__pgboss__send-it';
const APPLICATION = 'tps-db-tests-worker';
const entity = z.strictObject({ entityId: idSchema });
const empty = z.strictObject({});
let test: JobsTest;
let source: Queue<typeof entity, 'tenant'>;
let platform: Queue<typeof empty, 'platform'>;
let a: TestTenant;
let b: TestTenant;
const logger: JobLogger = { error: vi.fn() };

beforeAll(async () => {
  test = await startJobsTest();
  source = defineQueue(test.queues.source, 'tenant', entity);
  platform = defineQueue(test.queues.platform, 'platform', empty);
  [a, b] = [await createTestTenant(), await createTestTenant()];
}, 30_000);
afterAll(() => stopJobsTest(test));

function start(options: Partial<Parameters<typeof startWorker>[0]> = {}) {
  const { host, port, database, password } = connectionSettings('app_queue');
  return startWorker({
    queue: { host, port, database, password, applicationName: APPLICATION, maxConnections: 4 },
    setup: { db: test.worker, sender: test.workerSender, logger },
    handlers: [],
    schedules: [],
    onError: vi.fn(),
    ...options,
  });
}

/** The roles of this test's open app_queue connections. */
function runnerRoles(): Promise<string[]> {
  return withClient('migrator', async (client) => {
    const { rows } = await client.query<{ role: string }>(
      'SELECT DISTINCT usename AS role FROM pg_stat_activity WHERE application_name = $1',
      [APPLICATION],
    );
    return rows.map(({ role }) => role);
  });
}

function schedules() {
  return withClient('migrator', async (client) => {
    const { rows } = await client.query<{ name: string; timezone: string; data: object }>(
      'SELECT name, timezone, data FROM pgboss.schedule WHERE name = $1',
      [platform.name],
    );
    return rows;
  });
}

const context = () => ({ sender: test.apiSender, requestId: randomUUID(), causingUserId: null });

describe('the worker runner', { timeout: 60_000 }, () => {
  it('runs tenant jobs as app_worker from pg-boss as app_queue, and keeps only its schedules', async () => {
    const seen: unknown[] = [];
    const handler = defineHandler<unknown, typeof entity, 'tenant'>(source, async (trx) => {
      const { rows } = await sql<{ role: string; tenant: string }>`
        SELECT current_user AS role, app.current_tenant_id() AS tenant
      `.execute(trx);
      seen.push(rows[0]);
    });
    const schedule = defineSchedule(platform, '0 2 * * *', {});
    const runner = await start({ handlers: [handler], schedules: [schedule] });
    try {
      expect(await runnerRoles()).toEqual(['app_queue']);
      await withTenant(test.api, trustedTenantId(a.id), (trx) =>
        sendJob(trx, source, { entityId: randomUUID() }, context()),
      );
      await vi.waitFor(
        () => {
          expect(seen).toEqual([{ role: 'app_worker', tenant: a.id }]);
        },
        { timeout: 30_000, interval: 500 },
      );
      const [registered] = await schedules();
      expect(registered).toMatchObject({ name: platform.name, timezone: 'Europe/London' });
      expect(Object.keys(registered?.data ?? {}).sort()).toEqual(['causingUserId', 'requestId']);
    } finally {
      await stopWorker(runner, 5_000);
    }
    expect(await runnerRoles()).toEqual([]);

    await stopWorker(await start(), 5_000);
    expect(await schedules()).toEqual([]);
  });

  it('refuses a handler client that is not app_worker, and closes its connections', async () => {
    const handler = defineHandler(source, vi.fn());
    const setup = { db: test.api, sender: test.apiSender, logger };
    await expect(start({ handlers: [handler], setup })).rejects.toThrow('only as app_worker');
    expect(await runnerRoles()).toEqual([]);
  });
});

describe("pg-boss's cron queue", { timeout: 60_000 }, () => {
  it('takes occurrences from app_queue only', async () => {
    const occurrence = { name: CRON_QUEUE, data: { name: platform.name, key: '', data: {} } };
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleRolledBack(role, async (client) => {
        expect(await tryInsertJob(client, occurrence), role).toBe(REFUSED);
      });
    }
    await asRoleRolledBack('app_queue', async (client) => {
      expect(await tryInsertJob(client, occurrence)).toBe('ok');
    });
  });

  it('forwards an occurrence to a platform queue, and a tenant queue refuses it', async () => {
    const onError = vi.fn();
    const runner = await start({ onError });
    const requestId = randomUUID();
    const occurrence = (name: string) => ({
      name,
      key: '',
      data: {
        requestId,
        causingUserId: null,
        ...(name === source.name ? { entityId: requestId } : {}),
      },
    });
    try {
      await withClient('app_queue', async (client) => {
        for (const name of [platform.name, source.name]) {
          await client.query('INSERT INTO pgboss.job (name, data) VALUES ($1, $2)', [
            CRON_QUEUE,
            occurrence(name),
          ]);
        }
      });
      await vi.waitFor(
        async () => {
          expect(await jobRows("data->>'requestId' = $1", [requestId])).toEqual([
            expect.objectContaining({ name: platform.name, state: 'created' }),
          ]);
          expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: REFUSED }));
        },
        { timeout: 30_000, interval: 500 },
      );
    } finally {
      await stopWorker(runner, 5_000);
    }
  });
});

describe('a dead letter', { timeout: 60_000 }, () => {
  it('is read only in its tenant, sent again from there, then completed', async () => {
    const entityId = randomUUID();
    const sent = await withTenant(test.api, trustedTenantId(a.id), (trx) =>
      sendJob(trx, source, { entityId }, context()),
    );
    const boss = bossAs('app_queue');
    await boss.start();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [job] = await boss.fetch(source.name);
        await boss.fail(source.name, job?.id ?? '', { code: 'internal' });
      }
    } finally {
      await boss.stop({ graceful: false });
    }
    const [copy] = await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM pgboss.job WHERE source_id = $1',
        [sent],
      );
      return rows;
    });
    const id = copy?.id ?? '';

    const runner = await start();
    try {
      const inB = await withTenant(test.worker, trustedTenantId(b.id), (trx) =>
        readDeadLetter(runner, trx, source, id),
      );
      expect(inB).toBeNull();
      await expect(
        test.worker.transaction().execute((trx) => readDeadLetter(runner, trx, source, id)),
      ).rejects.toMatchObject({ code: 'no_tenant' });

      const [letter, resent] = await withTenant(test.worker, trustedTenantId(a.id), async (trx) => {
        const found = await readDeadLetter(runner, trx, source, id);
        if (found === null) throw new Error('The dead letter was not found.');
        const { requestId, causingUserId } = found;
        const resend = { sender: test.workerSender, requestId, causingUserId };
        return [found, await sendJob(trx, found.queue, found.data, resend)] as const;
      });
      expect(letter).toMatchObject({ id, data: { entityId }, causingUserId: null });
      await completeDeadLetter(runner, letter);

      const [job] = await jobRows('id = $1', [resent]);
      expect(job).toMatchObject({
        name: source.name,
        state: 'created',
        data: { tenantId: a.id, entityId },
      });
      expect(await jobRows('id = $1', [id])).toEqual([
        expect.objectContaining({ state: 'completed' }),
      ]);
      const again = await withTenant(test.worker, trustedTenantId(a.id), (trx) =>
        readDeadLetter(runner, trx, source, id),
      );
      expect(again).toBeNull();
      await expect(completeDeadLetter(runner, { ...letter })).rejects.toThrow('readDeadLetter()');
    } finally {
      await stopWorker(runner, 5_000);
    }
  });
});
