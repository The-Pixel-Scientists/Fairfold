// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox relay and replay against the test database (migrations 0097 and
// 0098), as app_worker and, for a replay, app_operator: order and batching,
// at-least-once delivery, the pass over a gap and the stop at an invalid event, one
// tenant's events and cursors never reaching another's, and the audited
// replay with its refusals.

import { randomUUID } from 'node:crypto';

import { withTenant } from '@pixel-scientists/db';
import { publish, sendJob, type PublishContext } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { defineEvent } from '@pixel-scientists/domain/events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { withClient } from '../../../../../packages/db/test/connect.ts';
import {
  startJobsTest,
  stopJobsTest,
  type JobsTest,
} from '../../../../../packages/db/test/jobs/helpers.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  outcome,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  BATCH_SIZE,
  relayBatch,
  relayFanOutHandler,
  relayFanOutQueue,
  relayHandler,
  relayQueue,
} from './relay.ts';
import { replayConsumer } from './replay.ts';

vi.setConfig({ testTimeout: 60_000 });

const submitted = defineEvent('grants.outbox_relay_test.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({ applicationId: idSchema }),
});

let test: JobsTest;
const tenants: string[] = [];
const log = { error: vi.fn(), info: vi.fn() };

beforeAll(async () => {
  test = await startJobsTest();
}, 30_000);
afterAll(async () => {
  await withClient('migrator', (client) =>
    client.query(`DELETE FROM pgboss.job WHERE name = ANY($1) AND data->>'tenantId' = ANY($2)`, [
      ['outbox.probe', relayQueue.name],
      tenants,
    ]),
  );
  await stopJobsTest(test);
});

async function freshTenant(): Promise<TestTenant> {
  const tenant = await createTestTenant();
  tenants.push(tenant.id);
  log.error.mockClear();
  log.info.mockClear();
  return tenant;
}

const asTenant = <T>(tenant: TestTenant, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
  withTenant(test.worker, trustedTenantId(tenant.id), work);

const context = (sender: PublishContext['sender'] = test.apiSender): PublishContext => ({
  sender,
  requestId: randomUUID(),
  causingUserId: null,
  causedBy: null,
});
const jobOf = () => ({ id: randomUUID(), context: context(test.workerSender) });

const publishOne = (tenant: TestTenant, applicationId = randomUUID()) =>
  withTenant(test.api, trustedTenantId(tenant.id), (trx) =>
    publish(trx, submitted, { applicationId }, context()),
  );

/** `count` events in one statement, as migrator: the database numbers each. */
const addEvents = (tenant: TestTenant, count: number) =>
  asMigratorIn(tenant.id, (client) =>
    client.query(
      `INSERT INTO app.event_outbox (tenant_id, id, type, payload, request_id)
       SELECT app.current_tenant_id(), gen_random_uuid(), 'grants.outbox_relay_test.v1',
              jsonb_build_object('applicationId', gen_random_uuid()), gen_random_uuid()
         FROM generate_series(1, $1)`,
      [count],
    ),
  );

/** One event already past `retain_until`, numbered by the database like any other. */
const addExpiredEvent = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, async (client) => {
    await client.query('ALTER TABLE app.event_outbox DISABLE TRIGGER set_event_retention');
    await client.query(
      `INSERT INTO app.event_outbox (tenant_id, id, type, payload, request_id, occurred_at, retain_until)
       VALUES (app.current_tenant_id(), gen_random_uuid(), 'grants.outbox_relay_test.v1',
               jsonb_build_object('applicationId', gen_random_uuid()), gen_random_uuid(),
               now() - interval '91 days', now() - interval '1 day')`,
    );
    await client.query('ALTER TABLE app.event_outbox ENABLE TRIGGER set_event_retention');
  });

/** The retention purge: the worker removes the tenant's events past `retain_until`. */
const purgeExpired = (tenant: TestTenant) =>
  asTenant(tenant, (trx) =>
    trx
      .$extendTables<{ 'app.event_outbox': { retain_until: Date } }>()
      .deleteFrom('app.event_outbox')
      .where('retain_until', '<', new Date())
      .execute(),
  );

/** One relay job as the wrapper would run it, in the tenant's transaction. */
const relay = (tenant: TestTenant) =>
  asTenant(tenant, (trx) =>
    relayHandler(log).handle(trx, {
      ...jobOf(),
      data: { slot: randomUUID(), consumer: 'probe' },
    }),
  );

/** The event numbers sent to the probe for `tenant`, one entry per job. */
async function delivered(tenant: TestTenant): Promise<number[]> {
  const { rows } = await withClient('migrator', (client) =>
    client.query<{ sequence: number }>(
      `SELECT (data->>'sequence')::integer AS sequence FROM pgboss.job
        WHERE name = 'outbox.probe' AND data->>'tenantId' = $1 ORDER BY 1`,
      [tenant.id],
    ),
  );
  return rows.map((row) => row.sequence);
}

async function cursor(tenant: TestTenant): Promise<number | undefined> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ last_sequence: string }>(
      `SELECT last_sequence FROM app.event_cursor WHERE tenant_id = $1 AND consumer = 'probe'`,
      [tenant.id],
    ),
  );
  return rows[0] === undefined ? undefined : Number(rows[0].last_sequence);
}

async function relayJobs(tenant: TestTenant) {
  const { rows } = await withClient('migrator', (client) =>
    client.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'tenantId' = $2`,
      [relayQueue.name, tenant.id],
    ),
  );
  return rows.map((row) => row.data);
}

const suspend = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, (client) =>
    client.query(`UPDATE app.tenant SET status = 'suspended' WHERE id = $1`, [tenant.id]),
  );

describe('the relay', () => {
  it('sends each event once in sequence order, moves the cursor to the last, and sends nothing twice', async () => {
    const tenant = await freshTenant();
    for (let n = 0; n < 3; n++) await publishOne(tenant);
    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 2, 3]);
    expect(await cursor(tenant)).toBe(3);

    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 2, 3]);
  });

  it('starts a new cursor with nothing sent when the tenant has no events', async () => {
    const tenant = await freshTenant();
    expect(await asTenant(tenant, (trx) => relayBatch(trx, 'probe', jobOf(), log))).toBe(0);
    expect(await cursor(tenant)).toBe(0);
  });

  it('moves a bounded batch, then sends the next relay job until none is left', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, BATCH_SIZE + 1);
    await relay(tenant);
    expect(await cursor(tenant)).toBe(BATCH_SIZE);
    expect(await relayJobs(tenant)).toHaveLength(1);

    await relay(tenant);
    expect(await cursor(tenant)).toBe(BATCH_SIZE + 1);
    expect(await relayJobs(tenant)).toHaveLength(1);
  });

  it('leaves the cursor and every send undone when the transaction rolls back, then redelivers', async () => {
    const tenant = await freshTenant();
    await publishOne(tenant);
    await publishOne(tenant);
    await expect(
      asTenant(tenant, async (trx) => {
        await relayBatch(trx, 'probe', jobOf(), log);
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow('crash before commit');
    expect(await delivered(tenant)).toEqual([]);
    expect(await cursor(tenant)).toBeUndefined();

    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 2]);
  });

  it('numbers events from two concurrent transactions in commit order, and delivers them in it', async () => {
    const tenant = await freshTenant();
    const [first, second] = [randomUUID(), randomUUID()];
    let started!: () => void;
    let release!: () => void;
    const hasStarted = new Promise<void>((resolve) => (started = resolve));
    const hold = new Promise<void>((resolve) => (release = resolve));
    const one = withTenant(test.api, trustedTenantId(tenant.id), async (trx) => {
      await publish(trx, submitted, { applicationId: first }, context());
      started();
      await hold;
    });
    await hasStarted;
    const two = publishOne(tenant, second);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await Promise.all([one, two]);

    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 2]);
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<{ id: string }>(
        `SELECT payload->>'applicationId' AS id FROM app.event_outbox ORDER BY sequence`,
      ),
    );
    expect(rows.map((row) => row.id)).toEqual([first, second]);
  });

  it('sends nothing twice when two relays for one tenant run at once', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, 5);
    await Promise.all([relay(tenant), relay(tenant)]);
    expect(await delivered(tenant)).toEqual([1, 2, 3, 4, 5]);
  });

  it('passes a gap left by retention, delivers the next event, and logs a code and count', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, 1);
    await addExpiredEvent(tenant);
    await addEvents(tenant, 1);
    await purgeExpired(tenant);
    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 3]);
    expect(await cursor(tenant)).toBe(3);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'sequence_gap', gaps: 1 }),
      expect.any(String),
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('resumes a cursor that is behind the oldest event kept once retention has removed the rows between', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, 2);
    await relay(tenant);
    await addExpiredEvent(tenant);
    await addEvents(tenant, 2);
    await purgeExpired(tenant);
    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1, 2, 4, 5]);
    expect(await cursor(tenant)).toBe(5);
  });

  it('stops before an event that does not match its contract, without logging its contents', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, 1);
    await asMigratorIn(tenant.id, (client) =>
      client.query(
        `INSERT INTO app.event_outbox (tenant_id, id, type, payload, request_id)
         VALUES (app.current_tenant_id(), gen_random_uuid(), 'grants.outbox_unknown_fact.v1',
                 '{"name":"Ada Lovelace"}', gen_random_uuid())`,
      ),
    );
    await addEvents(tenant, 1);
    await relay(tenant);
    expect(await delivered(tenant)).toEqual([1]);
    expect(await cursor(tenant)).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_event' }),
      expect.any(String),
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('Ada');
  });

  it('reads and moves only its own tenant’s events and cursors', async () => {
    const [a, b] = [await freshTenant(), await freshTenant()];
    await addEvents(a, 2);
    await addEvents(b, 3);
    await relay(a);
    expect(await delivered(a)).toEqual([1, 2]);
    expect(await delivered(b)).toEqual([]);
    expect(await cursor(b)).toBeUndefined();

    const seen = await asTenant(a, (trx) =>
      trx
        .$extendTables<{ 'app.event_cursor': { tenant_id: string } }>()
        .selectFrom('app.event_cursor')
        .select('tenant_id')
        .execute(),
    );
    expect(seen.map((row) => row.tenant_id)).toEqual([a.id]);
  });

  it('never updates an outbox row, or deletes one that has not expired', async () => {
    const tenant = await freshTenant();
    await addEvents(tenant, 1);
    const results = await asRoleIn('app_worker', tenant.id, async (client) => {
      const update = await outcome(client, "UPDATE app.event_outbox SET payload = '{}'");
      const deleted = await client.query('DELETE FROM app.event_outbox');
      return [update, deleted.rowCount];
    });
    expect(results).toEqual(['42501', 0]);
  });
});

describe('the fan-out', () => {
  it('sends each active tenant a relay job, and no suspended tenant', async () => {
    const [active, suspended] = [await freshTenant(), await freshTenant()];
    await suspend(suspended);
    const id = randomUUID();
    await relayFanOutHandler(log).handle(test.worker, {
      id,
      data: {},
      context: context(test.workerSender),
    });
    expect(await relayJobs(active)).toEqual([
      expect.objectContaining({ slot: id, consumer: 'probe', tenantId: active.id }),
    ]);
    expect(await relayJobs(suspended)).toEqual([]);
  });

  it('is out of app_api’s reach: it cannot send the platform job or list tenants', async () => {
    await expect(
      test.api
        .transaction()
        .execute((trx) => sendJob(trx, relayFanOutQueue, {}, context(test.apiSender))),
    ).rejects.toThrow();
    const refused = await withClient('app_api', async (client) => {
      await client.query('BEGIN');
      return outcome(client, 'SELECT * FROM app.tenant_ids()');
    });
    expect(refused).toBe('42501');
  });
});

describe('replay', () => {
  const replay = (tenant: TestTenant, consumer: string, from: number) =>
    replayConsumer(test.worker, trustedTenantId(tenant.id), {
      consumer,
      from,
      requestId: randomUUID(),
    });
  const audits = async (tenant: TestTenant) => {
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<{ actor_kind: string; changes: Record<string, unknown> }>(
        `SELECT actor_kind, changes FROM app.audit_event
          WHERE tenant_id = $1 AND action = 'platform.event_cursor.rewound'`,
        [tenant.id],
      ),
    );
    return rows;
  };

  /** A tenant with `count` events, all relayed. */
  async function relayed(count: number): Promise<TestTenant> {
    const tenant = await freshTenant();
    await addEvents(tenant, count);
    await relay(tenant);
    return tenant;
  }

  it('moves the cursor back so the next relay redelivers from there, and audits the operator, consumer and range', async () => {
    const tenant = await relayed(5);
    expect(await replay(tenant, 'probe', 3)).toEqual({ ok: true, from: 3, to: 5 });
    expect(await cursor(tenant)).toBe(2);
    const [event, ...more] = await audits(tenant);
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      actor_kind: 'operator',
      changes: {
        'app.event_cursor.consumer': { after: 'probe' },
        'app.event_cursor.last_sequence': { before: 5, after: 2 },
      },
    });

    await relay(tenant);
    expect(await cursor(tenant)).toBe(5);
    expect(await delivered(tenant)).toEqual([1, 2, 3, 3, 4, 4, 5, 5]);
  });

  it.each([
    ['an unknown consumer', 'webhooks', 1, 'unknown_consumer'],
    ['a start below 1', 'probe', 0, 'invalid_start'],
    ['a start that is not whole', 'probe', 1.5, 'invalid_start'],
    ['a start beyond the cursor', 'probe', 6, 'beyond_cursor'],
  ])('refuses %s and changes nothing', async (_, consumer, from, code) => {
    const tenant = await relayed(5);
    expect(await replay(tenant, consumer, from)).toEqual({ ok: false, code });
    expect(await cursor(tenant)).toBe(5);
    expect(await audits(tenant)).toEqual([]);
  });

  it('refuses a start older than the oldest event kept, a consumer with no cursor and a suspended tenant', async () => {
    const tenant = await freshTenant();
    await addExpiredEvent(tenant);
    await addEvents(tenant, 2);
    await relay(tenant);
    expect(await cursor(tenant)).toBe(3);
    expect(await replay(tenant, 'probe', 1)).toEqual({ ok: false, code: 'before_retained' });
    expect(await replay(tenant, 'probe', 2)).toMatchObject({ ok: true });

    expect(await replay(await freshTenant(), 'probe', 1)).toEqual({
      ok: false,
      code: 'no_cursor',
    });

    await suspend(tenant);
    expect(await replay(tenant, 'probe', 2)).toEqual({ ok: false, code: 'tenant_inactive' });
  });

  it('moves only the named tenant’s cursor', async () => {
    const [a, b] = [await relayed(3), await relayed(3)];
    await replay(a, 'probe', 1);
    expect(await cursor(a)).toBe(0);
    expect(await cursor(b)).toBe(3);
    expect(await audits(b)).toEqual([]);
  });

  it('is the only way a cursor moves back: the relay cannot', async () => {
    const tenant = await relayed(3);
    const back = await asRoleIn('app_worker', tenant.id, (client) =>
      outcome(client, 'UPDATE app.event_cursor SET last_sequence = 1'),
    );
    expect(back).toBe('55000');
  });
});
