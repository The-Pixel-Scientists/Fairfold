// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.session_memberships() (migration 0006, ADR 0019): for a live session that
// has finished MFA, its user's active memberships in active tenants, and
// nothing for any other session or another user's memberships.
//
// As in session-context.test.ts, sessions with times in the past and
// inactive accounts are written by migrator in a transaction that is rolled
// back, and the function is called as its owner role.

import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.ts';
import { sessionMemberships } from '../../src/tenant-functions.ts';
import { addUser, asRoleRolledBack, tokenHash } from '../auth/fixtures.ts';
import { asMigratorRolledBack, databaseSettings, withClient } from '../connect.ts';
import { createTestTenant, insertRow, outcome, type TestTenant } from '../tenants.ts';

interface Case {
  app?: 'console' | 'portal';
  mfaState?: string;
  /** How long ago the session was created, and last seen, as intervals. */
  created?: string;
  seen?: string;
  /** Better Auth's expiry, from now. */
  expires?: string;
  revoked?: boolean;
  userStatus?: 'active' | 'deactivated';
  unknownHash?: boolean;
}

let first: TestTenant;
let second: TestTenant;
let third: TestTenant;
let suspended: TestTenant;
beforeAll(async () => {
  [first, second, third, suspended] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
});

/** Add a membership of `user` in `tenant` through `client`, connected as migrator. */
async function addMembership(
  client: pg.ClientBase,
  tenant: TestTenant,
  user: string,
  roles: string[],
  status = 'active',
): Promise<string> {
  await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
  return insertRow(client, 'app.membership', {
    tenant_id: tenant.id,
    user_id: user,
    roles,
    status,
  });
}

/**
 * The function's rows for a session set up as `c` describes. The user is a
 * member of first and second, suspended in a third tenant and a member of
 * a suspended one; another user is a member of first.
 */
async function membershipsOf(c: Case) {
  return asMigratorRolledBack(async (client) => {
    const user = await addUser(client, c.userStatus ?? 'active');
    const other = await addUser(client);
    const expected = [
      await addMembership(client, first, user, ['reviewer']),
      await addMembership(client, second, user, ['tenant_admin', 'programme_manager']),
    ];
    await addMembership(client, third, user, ['reviewer'], 'suspended');
    await addMembership(client, suspended, user, ['reviewer']);
    await client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]);
    await addMembership(client, first, other, ['applicant']);

    const hash = tokenHash();
    await client.query(
      `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, expires_at, created_at,
                                 last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, now() + $5::interval, now() - $6::interval,
               now() - $7::interval, CASE WHEN $8 THEN now() END)`,
      [
        user,
        hash,
        c.app ?? 'console',
        c.mfaState ?? (c.app === 'portal' ? 'not_required' : 'complete'),
        c.expires ?? '7 days',
        c.created ?? '1 minute',
        c.seen ?? '0 minutes',
        c.revoked ?? false,
      ],
    );
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', '', true)");
    await client.query('SET LOCAL ROLE owner_auth_session_memberships');
    const { rows } = await client.query<{ membership_id: string }>(
      'SELECT * FROM auth.session_memberships($1)',
      [c.unknownHash ? tokenHash() : hash],
    );
    return { rows, expected };
  });
}

describe('auth.session_memberships()', { timeout: 30_000 }, () => {
  it.each<[string, Case]>([
    ['an MFA-complete console session', {}],
    ['a portal session', { app: 'portal', seen: '1 minute' }],
  ])("returns the user's active memberships in active tenants for %s", async (_, c) => {
    const { rows, expected } = await membershipsOf(c);
    expect(rows.map((row) => row.membership_id).sort()).toEqual([...expected].sort());
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          membership_id: expected[0],
          tenant_id: first.id,
          slug: first.slug,
          name: 'Test tenant',
          roles: ['reviewer'],
        },
        {
          membership_id: expected[1],
          tenant_id: second.id,
          slug: second.slug,
          name: 'Test tenant',
          roles: ['tenant_admin', 'programme_manager'],
        },
      ]),
    );
  });

  it.each<[string, Case]>([
    ['an unknown hash', { unknownHash: true }],
    ['a revoked session', { revoked: true }],
    ['an inactive user', { userStatus: 'deactivated' }],
    ["a session past Better Auth's expiry", { created: '2 hours', expires: '-1 minute' }],
    ['a console session idle for 31 minutes', { created: '1 hour', seen: '31 minutes' }],
    ['a console session older than 12 hours', { created: '12 hours 1 minute' }],
    [
      'a portal session idle for 61 minutes',
      { app: 'portal', created: '2 hours', seen: '61 minutes' },
    ],
    ['a portal session older than 24 hours', { app: 'portal', created: '24 hours 1 minute' }],
    ['a session waiting for MFA set-up', { mfaState: 'enrol' }],
    ['a session waiting for a code', { mfaState: 'verify' }],
  ])('returns nothing for %s', async (_, c) => {
    expect((await membershipsOf(c)).rows).toEqual([]);
  });

  describe('through sessionMemberships()', () => {
    let api: Kysely<unknown>;
    beforeAll(() => {
      api = createDatabase(databaseSettings('app_api', 1));
    });
    afterAll(() => api.destroy());

    it("is callable by app_api alone, and never returns another user's memberships", async () => {
      const mine = tokenHash();
      const addSession = async (client: pg.ClientBase, hash: Buffer) => {
        const id = await addUser(client);
        await client.query(
          `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, expires_at)
           VALUES ($1, $2, 'portal', 'not_required', now() + interval '1 day')`,
          [id, hash],
        );
        return id;
      };
      const users = await withClient('app_auth', async (client) => ({
        user: await addSession(client, mine),
        other: await addSession(client, tokenHash()),
      }));
      const membership = await withClient('migrator', async (client) => {
        await client.query('BEGIN');
        const id = await addMembership(client, first, users.user, ['applicant']);
        await addMembership(client, second, users.other, ['applicant']);
        await client.query('COMMIT');
        return id;
      });

      expect(await sessionMemberships(api, mine)).toEqual([
        {
          membershipId: membership,
          tenantId: first.id,
          slug: first.slug,
          name: 'Test tenant',
          roles: ['applicant'],
        },
      ]);
      for (const role of ['app_worker', 'app_queue', 'app_auth'] as const) {
        await asRoleRolledBack(role, async (client) => {
          expect(
            await outcome(client, 'SELECT * FROM auth.session_memberships($1)', [mine]),
            role,
          ).toBe('42501');
        });
      }
    });
  });

  it('lets its owner reach no other column or table', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query('SET LOCAL ROLE owner_auth_session_memberships');
      for (const statement of [
        'SELECT ip_address FROM auth.session',
        'SELECT active_tenant_id FROM auth.session',
        'SELECT email FROM auth."user"',
        'SELECT created_by FROM app.membership',
        'SELECT timezone FROM app.tenant',
        'SELECT id FROM app.tenant_theme',
        'SELECT id FROM auth.account',
        "UPDATE app.membership SET status = 'removed'",
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });
});
