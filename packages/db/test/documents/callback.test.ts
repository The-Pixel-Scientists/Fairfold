// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.resolve_signature_callback() (migration 0105): only app_api calls it,
// with no tenant set; it returns the tenant id and key version of an active
// connection of an active tenant, the same empty answer for every other
// reference, and nothing else; its owner reads no other column or table.

import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { connectionRow } from './fixtures.ts';

const RESOLVE = 'SELECT * FROM app.resolve_signature_callback($1)';

let active: TestTenant;
let suspended: TestTenant;
const hashes = { active: randomBytes(32), closed: randomBytes(32), suspended: randomBytes(32) };

beforeAll(async () => {
  [active, suspended] = [await createTestTenant(), await createTestTenant()];
  await asMigratorIn(active.id, async (client) => {
    await insertRow(
      client,
      'app.signature_connection',
      connectionRow(active, { callback_reference_hash: hashes.active, callback_key_version: 3 }),
    );
    const closed = await insertRow(
      client,
      'app.signature_connection',
      connectionRow(active, { provider: 'other', callback_reference_hash: hashes.closed }),
    );
    await client.query("UPDATE app.signature_connection SET status = 'closed' WHERE id = $1", [
      closed,
    ]);
  });
  await asMigratorIn(suspended.id, async (client) => {
    await insertRow(
      client,
      'app.signature_connection',
      connectionRow(suspended, { callback_reference_hash: hashes.suspended }),
    );
    await client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]);
  });
}, 30_000);

const resolve = (hash: Buffer) =>
  withClient('app_api', async (client) => {
    const result = await client.query<Record<string, unknown>>(RESOLVE, [hash]);
    return { fields: result.fields.map((field) => field.name), rows: result.rows };
  });

describe('app.resolve_signature_callback()', { timeout: 30_000 }, () => {
  it("gives app_api an active connection's tenant and key version, and no other column", async () => {
    expect(await resolve(hashes.active)).toEqual({
      fields: ['tenant_id', 'callback_key_version'],
      rows: [{ tenant_id: active.id, callback_key_version: 3 }],
    });
  });

  it.each([
    ['an unknown reference', randomBytes(32)],
    ['a closed connection', hashes.closed],
    ['a suspended tenant', hashes.suspended],
    ['a hash of the wrong length', Buffer.alloc(3)],
  ])('returns no row, and no error, for %s', async (_name, hash) => {
    expect((await resolve(hash)).rows).toEqual([]);
  });

  it('ignores a tenant set in the transaction, and sets none', () =>
    withClient('app_api', async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [suspended.id]);
      const { rows } = await client.query(RESOLVE, [hashes.active]);
      const { rows: after } = await client.query<{ tenant: string | null }>(
        "SELECT pg_catalog.current_setting('app.tenant_id', true) AS tenant",
      );
      await client.query('ROLLBACK');
      expect(rows).toHaveLength(1);
      expect(after[0]?.tenant).toBe(suspended.id);
    }));

  it.each(['app_worker', 'app_auth', 'app_queue'] as const)('refuses %s', (role) =>
    asRoleIn(role, active.id, async (client) => {
      expect(await outcome(client, RESOLVE, [hashes.active])).toBe('42501');
    }),
  );

  it('lets its owner read no other column or table', () =>
    withClient('migrator', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE owner_app_resolve_signature_callback');
        for (const statement of [
          'SELECT account_id FROM app.signature_connection',
          'SELECT api_token FROM app.signature_connection',
          'SELECT slug FROM app.tenant',
          'SELECT id FROM app.signature_request',
          'SELECT id FROM app.file',
          "UPDATE app.signature_connection SET status = 'closed'",
        ]) {
          expect(await outcome(client, statement), statement).toBe('42501');
        }
        expect(await outcome(client, 'SELECT id, status FROM app.signature_connection')).toBe('ok');
      } finally {
        await client.query('ROLLBACK');
      }
    }));
});
