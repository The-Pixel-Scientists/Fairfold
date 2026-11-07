// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.idempotency_key (migration 0017): isolation between tenants and
// between members, the checks, the times the database sets, the one change
// a key may make, and two requests racing for one key.

import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { expiredTimes, keyRow, KEYS, ROUTE, withExpiryTriggerOff } from './fixtures.ts';

/** A tenant with two members, and another tenant with its own. */
let tenant: TestTenant;
let other: TestTenant;
let member: string;
let second: string;
let stranger: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  second = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

const key = (change: Row = {}) => keyRow(tenant, member, change);

describe('app.idempotency_key', { timeout: 30_000 }, () => {
  it("keeps each tenant's keys from every other tenant, for every role with a grant", async () => {
    // Expired, so that app_worker, which deletes only expired keys, may
    // delete its own tenant's.
    await withExpiryTriggerOff(() =>
      expectCrossTenantDenial(KEYS, async (client, owner) => ({
        ...keyRow(owner, await addMember(client, owner)),
        ...expiredTimes(),
      })),
    );
  });

  it.each([
    [
      'accepts a route with a parameter',
      { route_id: 'POST /portal/applications/:id/submit' },
      'ok',
    ],
    ['refuses another method', { route_id: 'PUT /console/programmes' }, '23514'],
    ['refuses a public route', { route_id: 'POST /public/applications' }, '23514'],
    ['refuses an auth route', { route_id: 'POST /auth/sign-in' }, '23514'],
    ['refuses a route in capitals', { route_id: 'POST /console/Programmes' }, '23514'],
    ['refuses a trailing slash', { route_id: 'POST /console/programmes/' }, '23514'],
    ['refuses a long route', { route_id: `POST /console/${'a'.repeat(200)}` }, '23514'],
    ['accepts a version 7 key', { key: '01890a5d-ac96-774b-bcce-b302099a8057' }, 'ok'], // gitleaks:allow
    ['refuses a version 1 key', { key: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }, '23514'], // gitleaks:allow
    ['refuses the nil key', { key: '00000000-0000-0000-0000-000000000000' }, '23514'],
    ['refuses a short hash', { request_hash: randomBytes(31) }, '23514'],
    ['refuses an unknown state', { state: 'failed' }, '23514'],
    ['refuses a completed key with no status', { state: 'completed' }, '23514'],
    ['refuses a status while in progress', { status: 201 }, '23514'],
    ['refuses a created id while in progress', { created_id: randomUUID() }, '23514'],
    ['refuses a status other than 2xx', { state: 'completed', status: 409 }, '23514'],
    [
      'accepts a completed key with its status',
      { state: 'completed', status: 201, created_id: randomUUID() },
      'ok',
    ],
    ['refuses a member of another tenant', { membership_id: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    const values = change.membership_id === undefined ? change : { membership_id: stranger };
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values: params } = insertStatement(client, KEYS, key(values));
      expect(await outcome(client, text, params)).toBe(expected);
    });
  });

  it('sets created_at and expires_at itself, whatever is supplied', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const supplied = { created_at: new Date(0), expires_at: new Date('2100-01-01T00:00:00Z') };
      const id = await insertRow(client, KEYS, key(supplied));
      const { rows } = await client.query(
        `SELECT created_at = now() AS now, expires_at - created_at = interval '24 hours' AS day
           FROM app.idempotency_key WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ now: true, day: true }]);
    });
  });

  it('lets app_api reserve a key and complete it once, and change nothing else', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const supplied: Row = {
        id: randomUUID(),
        created_at: new Date(),
        expires_at: new Date(),
        state: 'in_progress',
        status: null,
        created_id: null,
      };
      for (const [column, value] of Object.entries(supplied)) {
        const { text, values } = insertStatement(client, KEYS, key({ [column]: value }));
        expect(await outcome(client, text, values), column).toBe('42501');
      }

      const id = await insertRow(client, KEYS, key());
      const completed = await client.query(
        `UPDATE app.idempotency_key SET state = 'completed', status = 201, created_id = $2
          WHERE id = $1 RETURNING state, status`,
        [id, randomUUID()],
      );
      expect(completed.rows).toEqual([{ state: 'completed', status: 201 }]);
      const update = (set: string) =>
        outcome(client, `UPDATE app.idempotency_key SET ${set} WHERE id = $1`, [id]);
      expect(await update('status = status'), 'no change').toBe('ok');
      expect(await update('status = 200'), 'a new status').toBe('55000');
      expect(
        await update("state = 'in_progress', status = NULL, created_id = NULL"),
        'back to in progress',
      ).toBe('55000');
      for (const column of [
        'id',
        'tenant_id',
        'membership_id',
        'route_id',
        'key',
        'request_hash',
        'created_at',
        'expires_at',
      ]) {
        expect(await update(`${column} = ${column}`), column).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.idempotency_key')).toBe('42501');
    });
  });

  it('refuses a change to what a key stands for, even from migrator', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(client, KEYS, key());
      const complete = (set: string, value: unknown) =>
        outcome(
          client,
          `UPDATE app.idempotency_key SET state = 'completed', status = 201, ${set} = $2
            WHERE id = $1`,
          [id, value],
        );
      expect(await complete('key', randomUUID())).toBe('55000');
      expect(await complete('request_hash', randomBytes(32))).toBe('55000');
      expect(await complete('route_id', 'POST /console/organisations')).toBe('55000');
      expect(await complete('membership_id', second)).toBe('55000');
      expect(await complete('created_id', randomUUID())).toBe('ok');
    });
  });

  it("keeps one member's key apart from another's in the same tenant", async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const shared = { key: randomUUID(), route_id: ROUTE };
      const mine = await insertRow(client, KEYS, keyRow(tenant, member, shared));
      const theirs = await insertRow(client, KEYS, keyRow(tenant, second, shared));
      expect(theirs).not.toBe(mine);
      const elsewhere = { ...shared, route_id: 'POST /console/organisations' };
      await insertRow(client, KEYS, keyRow(tenant, member, elsewhere));

      const again = insertStatement(client, KEYS, keyRow(tenant, member, shared));
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      const { rows } = await client.query(
        `SELECT id FROM app.idempotency_key
          WHERE tenant_id = $1 AND membership_id = $2 AND route_id = $3 AND key = $4`,
        [tenant.id, member, ROUTE, shared.key],
      );
      expect(rows).toEqual([{ id: mine }]);
    });
  });
});

describe('two requests with one key', { timeout: 30_000 }, () => {
  /** Wait until the session with `pid` waits on a lock held by `holder`'s session. */
  async function waitForBlock(holder: pg.ClientBase, pid: number): Promise<void> {
    for (let tries = 0; tries < 100; tries += 1) {
      const { rows } = await holder.query<{ blocked: boolean }>(
        'SELECT pg_catalog.pg_backend_pid() = ANY (pg_catalog.pg_blocking_pids($1)) AS blocked',
        [pid],
      );
      if (rows[0]?.blocked) return;
      await sleep(50);
    }
    throw new Error('The second insert never waited for the first.');
  }

  /** Insert one key in two transactions; end the first with `end`; the second's outcome. */
  function race(end: 'COMMIT' | 'ROLLBACK'): Promise<string> {
    const row = key();
    return withClient('app_api', (first) =>
      withClient('app_api', async (next) => {
        for (const client of [first, next]) {
          await client.query('BEGIN');
          await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
            tenant.id,
          ]);
        }
        const { text, values } = insertStatement(first, KEYS, row);
        await first.query(text, values);
        const { rows } = await next.query<{ pid: number }>(
          'SELECT pg_catalog.pg_backend_pid() AS pid',
        );
        const second = next.query(text, values).then(
          () => 'ok',
          (error: unknown) => (error as pg.DatabaseError).code ?? 'error',
        );
        await waitForBlock(first, rows[0]?.pid ?? 0);
        await first.query(end);
        const result = await second;
        await next.query('ROLLBACK');
        return result;
      }),
    );
  }

  it('make one row: the second waits, then fails once the first commits', async () => {
    expect(await race('COMMIT')).toBe('23505');
  });

  it('let the second insert once the first rolls back', async () => {
    expect(await race('ROLLBACK')).toBe('ok');
  });
});
