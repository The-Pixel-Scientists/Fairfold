// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The nightly retention jobs against the test database, as app_worker, for
// two tenants: the tenant sweep deletes its own tenant's expired audit events
// and no other tenant's or sign-in event, the platform job purges sign-in
// events and no tenant's, and a failed tenant job leaves the other's alone.
//
// Expired events exist only here: migrator adds them with the retention
// trigger off inside its own transaction, which turns it on again before
// committing.

import { randomUUID } from 'node:crypto';

import { withTenant } from '@pixel-scientists/db';
import { sendJob, type JobContext } from '@pixel-scientists/db/jobs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { withClient } from '../../../../../packages/db/test/connect.ts';
import {
  jobRows,
  startJobsTest,
  stopJobsTest,
  type JobsTest,
} from '../../../../../packages/db/test/jobs/helpers.ts';
import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { AUDIT_PURGE_CAP } from '../../platform/retention/index.ts';
import {
  auditPurgeHandler,
  MAX_CALLS,
  retentionSweepHandler,
  retentionSweepQueue,
} from './retention.ts';

vi.setConfig({ testTimeout: 60_000 });

let test: JobsTest;
let a: TestTenant;
let b: TestTenant;
const log = { error: vi.fn(), info: vi.fn() };

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

type SweepData = { slot: string; step?: number };

/** Run the tenant's sweep job as the wrapper would, in its transaction. */
const sweep = (tenant: TestTenant, after?: () => never, data: SweepData = { slot: randomUUID() }) =>
  inTenant(tenant, async (trx) => {
    await retentionSweepHandler(log).handle(trx, { id: randomUUID(), data, context: context() });
    after?.();
  });

/** The counts above zero of `tenant`'s purge events, largest first, read as migrator. */
async function purgeCounts(tenant: TestTenant): Promise<number[]> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ count: number }>(
      `SELECT (changes->>'count')::integer AS count FROM app.audit_event
        WHERE tenant_id = $1 AND action = 'platform.audit_event.purged'
          AND (changes->>'count')::integer > 0`,
      [tenant.id],
    ),
  );
  return rows.map((row) => row.count).sort((x, y) => y - x);
}

/** Add `count` app.audit_event rows to `tenant` that expired a month ago. */
async function addExpiredEvents(tenant: TestTenant, count: number): Promise<void> {
  await asMigratorIn(tenant.id, async (client) => {
    await client.query('ALTER TABLE app.audit_event DISABLE TRIGGER set_audit_retention');
    await client.query(
      `INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                    entity_id, changes, occurred_at, retain_until)
       SELECT $1::uuid, gen_random_uuid(), 'system', 'platform.tenant.updated',
              'platform.tenant', $1::uuid, '{}', o.at,
              ((o.at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'
         FROM (SELECT now() - interval '13 months' AS at) AS o, generate_series(1, $2)`,
      [tenant.id, count],
    );
    await client.query('ALTER TABLE app.audit_event ENABLE TRIGGER set_audit_retention');
  });
}

/** Add a sign-in event that expired a month ago, and return its id. */
async function addExpiredSignIn(): Promise<string> {
  return asMigratorIn(a.id, async (client) => {
    await client.query('ALTER TABLE auth.audit_event DISABLE TRIGGER set_audit_retention');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO auth.audit_event (request_id, code, occurred_at, retain_until)
       SELECT $1::uuid, 'sign_in_failed', o.at,
              ((o.at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'
         FROM (SELECT now() - interval '13 months' AS at) AS o
       RETURNING id`,
      [randomUUID()],
    );
    await client.query('ALTER TABLE auth.audit_event ENABLE TRIGGER set_audit_retention');
    return rows[0]?.id ?? '';
  });
}

/** How many expired app.audit_event rows `tenant` has, read as migrator. */
async function expired(tenant: TestTenant): Promise<number> {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM app.audit_event
        WHERE tenant_id = $1 AND retain_until < now()`,
      [tenant.id],
    ),
  );
  return rows[0]?.n ?? 0;
}

async function signInKept(id: string): Promise<boolean> {
  const { rowCount } = await withClient('migrator', (client) =>
    client.query('SELECT 1 FROM auth.audit_event WHERE id = $1', [id]),
  );
  return rowCount === 1;
}

describe('the tenant sweep', () => {
  it('purges its tenant’s expired events, however many, and no other tenant’s or sign-in event', async () => {
    const extra = 2_000;
    await addExpiredEvents(a, AUDIT_PURGE_CAP + extra);
    await addExpiredEvents(b, 5);
    const signIn = await addExpiredSignIn();
    expect(MAX_CALLS).toBeGreaterThan(2);

    await sweep(a);

    expect(await expired(a)).toBe(0);
    expect(await expired(b)).toBe(5);
    expect(await signInKept(signIn)).toBe(true);
    const { rows } = await asMigratorIn(a.id, (client) =>
      client.query<{ count: number; actor_kind: string }>(
        `SELECT (changes->>'count')::integer AS count, actor_kind FROM app.audit_event
          WHERE action = 'platform.audit_event.purged'`,
      ),
    );
    expect(rows.map((row) => row.count).sort((x, y) => y - x)).toEqual([AUDIT_PURGE_CAP, extra]);
    expect(rows.every((row) => row.actor_kind === 'system')).toBe(true);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'app.audit_event', deleted: AUDIT_PURGE_CAP + extra }),
      expect.any(String),
    );
  });

  it('counts nothing twice when the same night runs again', async () => {
    await sweep(a);
    expect(await expired(a)).toBe(0);
    expect(await expired(b)).toBe(5);
  });

  it('leaves another tenant’s expired events when this tenant’s job fails and rolls back', async () => {
    await addExpiredEvents(a, 3);
    await expect(
      sweep(a, () => {
        throw new Error('The job failed.');
      }),
    ).rejects.toThrow();
    expect(await expired(a)).toBe(3);

    await sweep(b);
    expect(await expired(b)).toBe(0);
    expect(await expired(a)).toBe(3);
    await sweep(a);
    expect(await expired(a)).toBe(0);
  });
});

describe('the platform job', () => {
  it('sends each tenant one sweep, and purges sign-in events but no tenant’s events', async () => {
    await addExpiredEvents(b, 4);
    const signIn = await addExpiredSignIn();
    const job = {
      id: randomUUID(),
      data: { target: 'platform.retention_sweep' },
      context: context(),
    };
    await auditPurgeHandler(log).handle(test.worker, job);

    expect(await signInKept(signIn)).toBe(false);
    expect(await expired(b)).toBe(4);
    const rows = await jobRows('name = $1 AND data->>$2 = $3', [
      'platform.retention_sweep',
      'slot',
      job.id,
    ]);
    const tenants = rows.map(({ data }) => data['tenantId']);
    expect(tenants).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(new Set(tenants).size).toBe(tenants.length);
    expect(
      rows.every(
        ({ data }) => Object.keys(data).sort().join() === 'causingUserId,requestId,slot,tenantId',
      ),
    ).toBe(true);
  });
});

describe('a job delivered twice', () => {
  it('deletes and counts nothing the second time, for the same slot and step', async () => {
    await addExpiredEvents(a, 7);
    const data = { slot: randomUUID(), step: 1 };
    await sweep(a, undefined, data);
    const once = await purgeCounts(a);
    expect(once).toContain(7);

    const others = await expired(b);
    await sweep(a, undefined, data);
    expect(await purgeCounts(a)).toEqual(once);
    expect(await expired(b)).toBe(others);
  });

  it('does no extra work when the real queue holds the same slot and step twice', async () => {
    const data = { slot: randomUUID(), step: 2 };
    await inTenant(a, async (trx) => {
      for (let sent = 0; sent < 2; sent++) {
        await sendJob(trx, retentionSweepQueue, data, context(), {
          singletonOn: ['slot', 'step'],
        });
      }
    });
    const queued = await jobRows('name = $1 AND data->>$2 = $3', [
      retentionSweepQueue.name,
      'slot',
      data.slot,
    ]);
    expect(queued.length).toBeGreaterThanOrEqual(1);

    await addExpiredEvents(a, 5);
    const before = await purgeCounts(a);
    for (let run = 0; run < queued.length; run++) await sweep(a, undefined, data);
    expect(await expired(a)).toBe(0);
    const after = await purgeCounts(a);
    expect(after.filter((count) => count === 5)).toHaveLength(1);
    expect(after).toEqual([...before, 5].sort((x, y) => y - x));
  });
});
