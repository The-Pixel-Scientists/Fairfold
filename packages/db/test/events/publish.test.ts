// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox write in publish() (ADR 0034): the row and the jobs commit or
// roll back together, events keep their order within a transaction, and a
// tenant's numbers follow commit order while tenants never wait for each
// other. events.insight is registered by S11-67's migration; until then this
// test creates it, as test/jobs/publish.test.ts does.

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { idSchema } from '@pixel-scientists/domain';
import {
  defineEvent,
  defineSubscriptions,
  type EventEnvelope,
} from '@pixel-scientists/domain/events';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { publish, type PublishContext } from '../../src/jobs/publish.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { withClient } from '../connect.ts';
import { createQueue } from '../jobs/fixtures.ts';
import { jobRows, startJobsTest, stopJobsTest, type JobsTest } from '../jobs/helpers.ts';
import { asMigratorIn, createTestTenant, type TestTenant } from '../tenants.ts';
import { beginIn, eventRow, insertEvent } from './fixtures.ts';

const QUEUE = 'events.insight';
const submitted = defineEvent('grants.outbox_test_submitted.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({ applicationId: idSchema }),
});
defineSubscriptions('insight', [submitted.name]);

let test: JobsTest;
let created = false;
let tenant: TestTenant;

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
  tenant = await createTestTenant();
}, 30_000);
afterAll(async () => {
  await withClient('migrator', async (client) => {
    await client.query('BEGIN');
    await client.query(`DELETE FROM pgboss.job WHERE name = $1 AND data->>'tenantId' = $2`, [
      QUEUE,
      tenant.id,
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
  causingUserId: null,
  causedBy: null,
});

interface OutboxRow {
  id: string;
  sequence: string;
  type: string;
  payload: { applicationId: string };
  request_id: string;
  caused_by: string | null;
}

/** The tenant's outbox rows for `applicationIds`, in number order, read as migrator. */
function outboxRows(applicationIds: readonly string[]): Promise<OutboxRow[]> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, sequence, type, payload, request_id, caused_by FROM app.event_outbox
        WHERE payload->>'applicationId' = ANY($1) ORDER BY sequence`,
      [applicationIds],
    );
    return rows;
  });
}

async function jobsFor(applicationId: string): Promise<EventEnvelope[]> {
  const rows = await jobRows(`name = $1 AND data->'event'->'data'->>'applicationId' = $2`, [
    QUEUE,
    applicationId,
  ]);
  return rows.map((row) => row.data['event'] as EventEnvelope);
}

describe('publish and the outbox', { timeout: 30_000 }, () => {
  it('writes the outbox row and sends the jobs, with one id and number, once committed', async () => {
    const applicationId = randomUUID();
    const ctx = context();
    await withTenant(test.api, trustedTenantId(tenant.id), (trx) =>
      publish(trx, submitted, { applicationId }, ctx),
    );
    const [row, ...more] = await outboxRows([applicationId]);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      type: submitted.name,
      payload: { applicationId },
      request_id: ctx.requestId,
      caused_by: null,
    });
    const jobs = await jobsFor(applicationId);
    expect(jobs).toEqual([
      expect.objectContaining({ id: row?.id, sequence: Number(row?.sequence) }) as unknown,
    ]);
  });

  it('leaves neither row nor job when the publishing transaction rolls back', async () => {
    const applicationId = randomUUID();
    await expect(
      withTenant(test.api, trustedTenantId(tenant.id), async (trx) => {
        await publish(trx, submitted, { applicationId }, context());
        throw new Error('Roll back.');
      }),
    ).rejects.toThrow('Roll back.');
    expect(await outboxRows([applicationId])).toEqual([]);
    expect(await jobsFor(applicationId)).toEqual([]);
  });

  it('keeps the order of events published in one transaction', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await withTenant(test.worker, trustedTenantId(tenant.id), async (trx) => {
      for (const applicationId of ids) {
        await publish(
          trx,
          submitted,
          { applicationId },
          { ...context(), sender: test.workerSender },
        );
      }
    });
    const rows = await outboxRows(ids);
    expect(rows.map((row) => row.payload.applicationId)).toEqual(ids);
    const numbers = rows.map((row) => Number(row.sequence));
    expect(numbers).toEqual([numbers[0], (numbers[0] ?? 0) + 1, (numbers[0] ?? 0) + 2]);
  });
});

describe("a tenant's event numbers", { timeout: 30_000 }, () => {
  /** Two app_api clients, each in its own open transaction. */
  async function twoClients<T>(work: (first: pg.Client, second: pg.Client) => Promise<T>) {
    return withClient('app_api', (first) =>
      withClient('app_api', async (second) => {
        try {
          return await work(first, second);
        } finally {
          await first.query('ROLLBACK');
          await second.query('ROLLBACK');
        }
      }),
    );
  }
  const waited = (pending: Promise<unknown>) =>
    Promise.race([pending.then(() => 'done'), sleep(500).then(() => 'waiting')]);

  it('follow commit order: a second publisher waits, then takes the next number', async () => {
    const fresh = await createTestTenant();
    const numbers = await twoClients(async (first, second) => {
      await beginIn(first, fresh);
      await beginIn(second, fresh);
      const one = await insertEvent(first, eventRow(fresh));
      const pending = insertEvent(second, eventRow(fresh));
      expect(await waited(pending)).toBe('waiting');
      await first.query('COMMIT');
      const two = await pending;
      await second.query('COMMIT');
      return [one, two];
    });
    expect(numbers).toEqual([1, 2]);
  });

  it('give a rolled-back number to the next publisher', async () => {
    const fresh = await createTestTenant();
    const numbers = await twoClients(async (first, second) => {
      await beginIn(first, fresh);
      await beginIn(second, fresh);
      const one = await insertEvent(first, eventRow(fresh));
      const pending = insertEvent(second, eventRow(fresh));
      await first.query('ROLLBACK');
      return [one, await pending];
    });
    expect(numbers).toEqual([1, 1]);
  });

  it('never make one tenant wait for another', async () => {
    const [a, b] = [await createTestTenant(), await createTestTenant()];
    const numbers = await twoClients(async (first, second) => {
      await beginIn(first, a);
      await beginIn(second, b);
      // A wait for A's counter would fail here rather than hang.
      await second.query("SET LOCAL lock_timeout = '2s'");
      return [await insertEvent(first, eventRow(a)), await insertEvent(second, eventRow(b))];
    });
    expect(numbers).toEqual([1, 1]);
  });
});
