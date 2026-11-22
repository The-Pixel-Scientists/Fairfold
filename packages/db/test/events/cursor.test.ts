// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.event_cursor (migration 0098): isolation between tenants; app_worker
// moves a cursor only forward and never past the tenant's last event;
// app_operator, for a replay, moves one only back and never before the
// oldest event its tenant still keeps; app_api has no rights at all.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withRoleClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { asMigratorIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import {
  beginIn,
  eventRow,
  expiredTimes,
  insertEvent,
  withRetentionTriggerOff,
} from './fixtures.ts';

const CURSOR = 'app.event_cursor';

/** A tenant whose event 1 has expired and events 2 and 3 are kept. */
async function tenantWithEvents(): Promise<TestTenant> {
  const tenant = await createTestTenant();
  await withRetentionTriggerOff(() =>
    asMigratorIn(tenant.id, (client) =>
      insertEvent(client, { ...eventRow(tenant), ...expiredTimes() }),
    ),
  );
  await asMigratorIn(tenant.id, async (client) => {
    await insertEvent(client, eventRow(tenant));
    await insertEvent(client, eventRow(tenant));
  });
  return tenant;
}

/** Run `work` as `role` in a transaction with `tenant` set, and roll it back. */
function inTenantAs<T>(
  role: 'app_api' | 'app_worker' | 'app_operator',
  tenant: TestTenant,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withRoleClient(role, async (client) => {
    await beginIn(client, tenant);
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

let relayed: TestTenant;
let replayed: TestTenant;
beforeAll(async () => {
  [relayed, replayed] = [await tenantWithEvents(), await tenantWithEvents()];
  // Another tenant's kept event 1 must not let the replay below reach 0.
  const other = await createTestTenant();
  await asMigratorIn(other.id, (client) => insertEvent(client, eventRow(other)));
  await asMigratorIn(replayed.id, (client) =>
    client.query(
      `INSERT INTO app.event_cursor (tenant_id, consumer, last_sequence) VALUES ($1, 'probe', 3)`,
      [replayed.id],
    ),
  );
}, 60_000);

const insert = (sequence: number, consumer = 'probe') =>
  `INSERT INTO app.event_cursor (tenant_id, consumer, last_sequence)
   VALUES (app.current_tenant_id(), '${consumer}', ${String(sequence)})`;
const move = (sequence: number) =>
  `UPDATE app.event_cursor SET last_sequence = ${String(sequence)}`;

describe('app.event_cursor', { timeout: 30_000 }, () => {
  it("keeps each tenant's cursors from every other tenant, for every role with a grant", async () => {
    await expectCrossTenantDenial(CURSOR, (_, owner) => ({
      tenant_id: owner.id,
      consumer: 'probe',
      last_sequence: 0,
    }));
  });

  it('lets app_worker move a cursor only forward, up to the last event', async () => {
    const results = await inTenantAs('app_worker', relayed, async (client) => {
      const step = (text: string) => outcome(client, text);
      return [
        await step(insert(4)),
        await step(insert(0, 'webhooks')),
        await client.query(insert(1)).then(() => 'ok'),
        await step(move(3)),
        await step(move(1)),
        await step(move(0)),
        await step(move(4)),
        await step(`UPDATE app.event_cursor SET consumer = 'probe'`),
        await step('DELETE FROM app.event_cursor'),
      ];
    });
    expect(results).toEqual([
      '55000',
      '23514',
      'ok',
      'ok',
      'ok',
      '55000',
      '55000',
      '42501',
      '42501',
    ]);
  });

  it('sets updated_at itself', async () => {
    const recent = await inTenantAs('app_worker', relayed, async (client) => {
      await client.query(insert(1));
      await client.query(
        `UPDATE app.event_cursor SET last_sequence = 2, updated_at = '2000-01-01T00:00:00Z'`,
      );
      const { rows } = await client.query<{ recent: boolean }>(
        'SELECT updated_at = now() AS recent FROM app.event_cursor',
      );
      return rows.map((row) => row.recent);
    });
    expect(recent).toEqual([true]);
  });

  it("lets app_operator move a cursor only back, no earlier than its tenant's oldest kept event", async () => {
    const results = await inTenantAs('app_operator', replayed, async (client) => {
      const step = (text: string) => outcome(client, text);
      return [
        await step(move(1)),
        await step(move(0)),
        await step(move(3)),
        await step(move(4)),
        await step(insert(0)),
        await step('DELETE FROM app.event_cursor'),
      ];
    });
    expect(results).toEqual(['ok', '55000', 'ok', '55000', '42501', '42501']);
  });

  it('gives app_api no rights on cursors', async () => {
    const results = await inTenantAs('app_api', relayed, async (client) => [
      await outcome(client, 'SELECT FROM app.event_cursor'),
      await outcome(client, insert(0)),
      await outcome(client, move(0)),
    ]);
    expect(results).toEqual(['42501', '42501', '42501']);
  });
});
