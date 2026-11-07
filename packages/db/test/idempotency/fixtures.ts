// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the idempotency tests. The database sets a key's times on
// insert, so an expired key can only be added by migrator with the expiry
// trigger off.

import { randomBytes, randomUUID } from 'node:crypto';

import { withClient } from '../connect.ts';
import type { Row, TestTenant } from '../tenants.ts';

export const KEYS = 'app.idempotency_key';
export const ROUTE = 'POST /console/programmes';

/** A new key, in progress, for `membership` in `tenant`. */
export function keyRow(tenant: TestTenant, membership: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    membership_id: membership,
    route_id: ROUTE,
    key: randomUUID(),
    request_hash: randomBytes(32),
    ...change,
  };
}

/** The times of a key made 25 hours ago, which expired an hour ago. */
export function expiredTimes(): Row {
  const created = new Date(Date.now() - 25 * 3_600_000);
  return { created_at: created, expires_at: new Date(created.getTime() + 24 * 3_600_000) };
}

/** Run `work` with the expiry trigger off, and turn it on again whatever happens. */
export async function withExpiryTriggerOff<T>(work: () => Promise<T>): Promise<T> {
  const set = (state: 'DISABLE' | 'ENABLE') =>
    withClient('migrator', (client) =>
      client.query(`ALTER TABLE app.idempotency_key ${state} TRIGGER set_idempotency_key_expiry`),
    );
  await set('DISABLE');
  try {
    return await work();
  } finally {
    await set('ENABLE');
  }
}
