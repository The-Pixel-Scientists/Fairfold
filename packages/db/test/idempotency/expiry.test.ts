// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The purges (migration 0017): app.delete_expired_idempotency_keys() and
// app.delete_expired_request_limits() delete at most max_rows expired rows
// that row-level security lets app_worker reach, and only app_worker may
// call them.

import { randomBytes } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  committedIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { expiredTimes, keyRow, KEYS, withExpiryTriggerOff } from './fixtures.ts';

const PURGES = ['app.delete_expired_idempotency_keys', 'app.delete_expired_request_limits'];

async function purge(client: pg.ClientBase, purgeFunction: string, maxRows: number) {
  const { rows } = await client.query<{ deleted: number }>(
    `SELECT ${purgeFunction}($1) AS deleted`,
    [maxRows],
  );
  return rows[0]?.deleted;
}

/** Add `count` keys to `tenant` that have expired. */
function addExpiredKeys(tenant: TestTenant, membership: string, count: number) {
  return withExpiryTriggerOff(() =>
    asMigratorIn(tenant.id, async (client) => {
      for (let added = 0; added < count; added += 1) {
        await insertRow(client, KEYS, { ...keyRow(tenant, membership), ...expiredTimes() });
      }
    }),
  );
}

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let stranger: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

describe('the purges', { timeout: 30_000 }, () => {
  it("delete at most max_rows of the tenant's expired keys, and no other key", async () => {
    await addExpiredKeys(tenant, member, 3);
    await addExpiredKeys(other, stranger, 1);
    const live = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, KEYS, keyRow(tenant, member)),
    );
    const purgeKeys = (client: pg.ClientBase, maxRows: number) =>
      purge(client, 'app.delete_expired_idempotency_keys', maxRows);

    await withClient('app_worker', (client) =>
      committedIn(client, tenant.id, async (inTenant) => {
        expect(await purgeKeys(inTenant, 2)).toBe(2);
        expect(await purgeKeys(inTenant, 10_000)).toBe(1);
        expect(await purgeKeys(inTenant, 10_000)).toBe(0);
      }),
    );
    const left = (owner: TestTenant) =>
      asMigratorIn(owner.id, (client) =>
        client.query<{ id: string }>('SELECT id FROM app.idempotency_key'),
      );
    expect((await left(tenant)).rows).toEqual([{ id: live }]);
    expect((await left(other)).rowCount, "the other tenant's expired key").toBe(1);
    expect(await withClient('app_worker', (client) => purgeKeys(client, 10_000)), 'no tenant').toBe(
      0,
    );
  });

  it('delete at most max_rows expired counters, and no counter in force', async () => {
    const purgeLimits = (client: pg.ClientBase, maxRows: number) =>
      purge(client, 'app.delete_expired_request_limits', maxRows);
    const counter = (windowStart: Date) => ({
      bucket: 'general',
      key_hash: randomBytes(32),
      window_start: windowStart,
      count: 1,
    });
    const old = new Date(Date.now() - 25 * 3_600_000);
    const live = counter(new Date());

    await withClient('app_worker', async (client) => {
      // Counters belong to no tenant, so first clear those earlier runs left.
      let deleted;
      do {
        deleted = await purgeLimits(client, 10_000);
      } while (deleted !== 0);
    });
    await withClient('app_api', async (client) => {
      for (const row of [counter(old), counter(old), counter(old), live]) {
        const { text, values } = insertStatement(client, 'app.request_limit', row);
        await client.query(text, values);
      }
    });
    await withClient('app_worker', async (client) => {
      expect(await purgeLimits(client, 2)).toBe(2);
      expect(await purgeLimits(client, 10_000)).toBe(1);
      expect(await purgeLimits(client, 10_000)).toBe(0);
    });
    const kept = await withClient('app_api', (client) =>
      client.query('SELECT 1 FROM app.request_limit WHERE key_hash = $1', [live.key_hash]),
    );
    expect(kept.rowCount).toBe(1);
  });

  it.each(PURGES)('%s refuses max_rows below 1, above 10000 or null', async (purgeFunction) => {
    await withClient('app_worker', async (client) => {
      await client.query('BEGIN');
      for (const maxRows of [0, 10_001, null]) {
        const statement = `SELECT ${purgeFunction}($1)`;
        expect(await outcome(client, statement, [maxRows]), String(maxRows)).toBe('22023');
      }
    });
  });

  it.each(PURGES)('%s may be called by app_worker alone', async (purgeFunction) => {
    for (const role of APP_ROLES.filter((name) => name !== 'app_worker')) {
      await withClient(role, async (client) => {
        await client.query('BEGIN');
        expect(await outcome(client, `SELECT ${purgeFunction}(1)`), role).toBe('42501');
      });
    }
  });
});
