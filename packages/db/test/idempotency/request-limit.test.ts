// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.request_limit (migration 0017): a store of hashed client keys and
// counters with no tenant, which app_api may upsert but not delete, which
// app_worker sees only once expired, and whose expiry the database sets.

import { randomBytes } from 'node:crypto';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { withClient } from '../connect.ts';
import { insertStatement, outcome, type Row } from '../tenants.ts';

const LIMITS = 'app.request_limit';

function counter(change: Row = {}): Row {
  return {
    bucket: 'general',
    key_hash: randomBytes(32),
    window_start: new Date(),
    count: 1,
    ...change,
  };
}

/** Run `work` as `role`, with no tenant set, in a transaction that is rolled back. */
function rolledBack<T>(role: LoginRole, work: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

describe('app.request_limit', { timeout: 30_000 }, () => {
  it('holds only a bucket, a key hash, a window, a count and an expiry', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ column: string }>(
        `SELECT column_name AS column FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'request_limit' ORDER BY 1`,
      ),
    );
    expect(rows.map((row) => row.column)).toEqual([
      'bucket',
      'count',
      'expires_at',
      'key_hash',
      'window_start',
    ]);
  });

  it('lets app_api count requests with an upsert, and sets the expiry itself', async () => {
    await rolledBack('app_api', async (client) => {
      const hash = randomBytes(32);
      const start = new Date();
      const upsert = () =>
        client.query(
          `INSERT INTO app.request_limit (bucket, key_hash, window_start, count)
           VALUES ('public', $1, $2, 1)
           ON CONFLICT (bucket, key_hash, window_start)
           DO UPDATE SET count = request_limit.count + 1
           RETURNING count, expires_at - window_start = interval '24 hours' AS day`,
          [hash, start],
        );
      expect((await upsert()).rows).toEqual([{ count: 1, day: true }]);
      expect((await upsert()).rows).toEqual([{ count: 2, day: true }]);
    });
  });

  it.each([
    ['refuses a clear IPv4 address', { key_hash: Buffer.from([192, 0, 2, 1]) }, '23514'],
    ['refuses a clear identifier', { key_hash: Buffer.from('jo@example.test') }, '23514'],
    ['refuses a 16-byte hash', { key_hash: randomBytes(16) }, '23514'],
    ['refuses an unknown bucket', { bucket: 'sign_in' }, '23514'],
    ['refuses a negative count', { count: -1 }, '23514'],
    ['accepts a 32-byte hash in a known bucket', { bucket: 'probe' }, 'ok'],
  ])('%s', async (_, change: Row, expected) => {
    await rolledBack('app_api', async (client) => {
      const { text, values } = insertStatement(client, LIMITS, counter(change));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('lets app_api change only the count, and never delete', async () => {
    await rolledBack('app_api', async (client) => {
      const expiring = insertStatement(client, LIMITS, counter({ expires_at: new Date() }));
      expect(await outcome(client, expiring.text, expiring.values), 'its own expiry').toBe('42501');
      const { text, values } = insertStatement(client, LIMITS, counter());
      await client.query(text, values);
      for (const column of ['bucket', 'key_hash', 'window_start', 'expires_at']) {
        expect(
          await outcome(client, `UPDATE app.request_limit SET ${column} = ${column}`),
          column,
        ).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.request_limit')).toBe('42501');
    });
  });

  it('shows app_worker only expired counters, and lets it add or change none', async () => {
    const live = counter();
    await withClient('app_api', async (client) => {
      const { text, values } = insertStatement(client, LIMITS, live);
      await client.query(text, values);
    });
    await rolledBack('app_worker', async (client) => {
      const where = 'FROM app.request_limit WHERE key_hash = $1';
      expect((await client.query(`SELECT 1 ${where}`, [live.key_hash])).rowCount).toBe(0);
      expect((await client.query(`DELETE ${where}`, [live.key_hash])).rowCount).toBe(0);
      const { text, values } = insertStatement(client, LIMITS, counter());
      for (const [statement, params] of [
        ['SELECT count FROM app.request_limit', []],
        ['UPDATE app.request_limit SET count = 0', []],
        [text, values],
      ] as const) {
        expect(await outcome(client, statement, params), statement).toBe('42501');
      }
    });
  });

  it.each(['app_auth', 'app_queue'] as const)('gives %s no access', async (role) => {
    await rolledBack(role, async (client) => {
      expect(await outcome(client, 'SELECT 1 FROM app.request_limit')).toBe('42501');
    });
  });
});
