// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.audit_event and auth.audit_copy_pending (migration 0004, ADR 0010):
// append-only for app_auth and migrator, times the database sets, kept
// exactly 12 months, codes and reasons checked, and pending copies that hold
// only an event id.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { asMigratorRolledBack } from '../connect.ts';
import { outcome } from '../tenants.ts';
import { asRoleRolledBack } from './fixtures.ts';

const insert = `INSERT INTO auth.audit_event (request_id, code, reason, identifier, ip_address)
  VALUES ($1, $2, $3, 'someone@example.test', '192.0.2.1') RETURNING id`;

async function addEvent(client: pg.ClientBase, code = 'sign_in_failed'): Promise<string> {
  const { rows } = await client.query<{ id: string }>(insert, [
    randomUUID(),
    code,
    'wrong_password',
  ]);
  const [row] = rows;
  if (!row) throw new Error('The insert into auth.audit_event returned no row.');
  return row.id;
}

describe('auth.audit_event', { timeout: 30_000 }, () => {
  it('lets app_auth add and read events, but never change or remove one', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const id = await addEvent(client);
      const { rows } = await client.query(
        `SELECT code, occurred_at = now() AS now,
                retain_until = ((occurred_at AT TIME ZONE 'UTC') + interval '12 months')
                  AT TIME ZONE 'UTC' AS twelve_months
           FROM auth.audit_event WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ code: 'sign_in_failed', now: true, twelve_months: true }]);

      for (const change of ['code = code', 'retain_until = now()', 'occurred_at = now()']) {
        expect(await outcome(client, `UPDATE auth.audit_event SET ${change}`), change).toBe(
          '42501',
        );
      }
      expect(await outcome(client, 'DELETE FROM auth.audit_event')).toBe('42501');
      for (const column of ['occurred_at', 'retain_until']) {
        expect(
          await outcome(
            client,
            `INSERT INTO auth.audit_event (request_id, code, ${column}) VALUES ($1, 'signed_out', now())`,
            [randomUUID()],
          ),
          column,
        ).toBe('42501');
      }
    });
  });

  it('lets migrator, which owns the table, change and remove no event either', async () => {
    await asMigratorRolledBack(async (client) => {
      const id = await addEvent(client);
      const changed = await client.query(
        `UPDATE auth.audit_event SET retain_until = now(), occurred_at = now() WHERE id = $1`,
        [id],
      );
      const removed = await client.query('DELETE FROM auth.audit_event WHERE id = $1', [id]);
      expect([changed.rowCount, removed.rowCount]).toEqual([0, 0]);
    });
  });

  it.each([
    ['an unknown code', 'password_seen', 'wrong_password', '23514'],
    ['a reason that is not a code', 'sign_in_failed', 'Wrong password for a@example.test', '23514'],
    ['a known code and reason', 'rate_limit_reached', 'sign_in_ip', 'ok'],
  ])('%s gives %s', async (_, code, reason, expected) => {
    await asRoleRolledBack('app_auth', async (client) => {
      expect(await outcome(client, insert, [randomUUID(), code, reason])).toBe(expected);
    });
  });
});

describe('auth.audit_copy_pending', { timeout: 30_000 }, () => {
  it('lets app_auth add, read and remove pending copies, but not change one', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const id = await addEvent(client, 'tenant_switched');
      await client.query('INSERT INTO auth.audit_copy_pending (auth_event_id) VALUES ($1)', [id]);
      const { rows } = await client.query(
        'SELECT created_at = now() AS now FROM auth.audit_copy_pending WHERE auth_event_id = $1',
        [id],
      );
      expect(rows).toEqual([{ now: true }]);
      expect(
        await outcome(client, 'UPDATE auth.audit_copy_pending SET auth_event_id = auth_event_id'),
      ).toBe('42501');
      expect(
        await outcome(client, 'INSERT INTO auth.audit_copy_pending (auth_event_id) VALUES ($1)', [
          randomUUID(),
        ]),
      ).toBe('23503');
      expect(
        await outcome(client, 'DELETE FROM auth.audit_copy_pending WHERE auth_event_id = $1', [id]),
      ).toBe('ok');
    });
  });
});
