// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the event outbox tests (migration 0097). The database sets an
// event's times on insert, so an expired event can only be added by migrator
// with the retention trigger off. Payloads hold ids only, as publish()
// writes them.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { withClient } from '../connect.ts';
import { insertStatement, type Row, type TestTenant } from '../tenants.ts';

export const OUTBOX = 'app.event_outbox';
export const TYPE = 'grants.outbox_test_submitted.v1';
const DAY = 86_400_000;

/** An event's columns as publish() writes them, in `tenant`. */
export function eventRow(tenant: TestTenant, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    id: randomUUID(),
    type: TYPE,
    payload: JSON.stringify({ applicationId: randomUUID() }),
    request_id: randomUUID(),
    caused_by: null,
    ...change,
  };
}

/** The times of an event from 91 days ago, which expired a day ago. */
export function expiredTimes(): Row {
  const occurred = new Date(Date.now() - 91 * DAY);
  return { occurred_at: occurred, retain_until: new Date(occurred.getTime() + 90 * DAY) };
}

/** Run `work` with the retention trigger off, and turn it on again whatever happens. */
export async function withRetentionTriggerOff<T>(work: () => Promise<T>): Promise<T> {
  const set = (state: 'DISABLE' | 'ENABLE') =>
    withClient('migrator', (client) =>
      client.query(`ALTER TABLE app.event_outbox ${state} TRIGGER set_event_retention`),
    );
  await set('DISABLE');
  try {
    return await work();
  } finally {
    await set('ENABLE');
  }
}

/** Insert `row` on `client`, whose transaction has the row's tenant set, and return its number. */
export async function insertEvent(client: pg.ClientBase, row: Row): Promise<number> {
  const { text, values } = insertStatement(client, OUTBOX, row);
  const { rows } = await client.query<{ sequence: string }>(`${text} RETURNING sequence`, values);
  return Number(rows[0]?.sequence);
}

/** Begin a transaction on `client` with `tenant` set. */
export async function beginIn(client: pg.ClientBase, tenant: TestTenant): Promise<void> {
  await client.query('BEGIN');
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
}
