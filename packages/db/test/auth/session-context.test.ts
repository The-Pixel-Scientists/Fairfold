// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.session_context() (migration 0004, ADR 0003, ADR 0010): the values of
// a live session, and nothing for an unknown hash, a revoked session, an
// inactive user, a session past either of its app's timeouts or Better
// Auth's expiry, or one waiting for MFA for more than 10 minutes.
//
// Sessions with times in the past, and inactive accounts, can only be
// written by migrator, the tables' owner. So each case runs as migrator in a
// transaction that is rolled back, and calls the function as its owner role.
// The function is SECURITY DEFINER, so it runs as that role whoever calls
// it, under that role's own policies.

import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import { createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { addUser, asRoleRolledBack, tokenHash } from './fixtures.ts';

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
  /** Look up a different hash from the one stored. */
  unknownHash?: boolean;
}

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await createTestTenant();
});

/** The function's rows for a session set up as `c` describes, with each end checked. */
async function contextOf(c: Case) {
  return asMigratorRolledBack(async (client) => {
    const user = await addUser(client, c.userStatus ?? 'active');
    const hash = tokenHash();
    await client.query(
      `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at,
                                 created_at, last_seen_at, reauthenticated_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, now() + $6::interval, now() - $7::interval,
               now() - $8::interval, now() - $7::interval,
               CASE WHEN $9 THEN now() END)`,
      [
        user,
        hash,
        c.app ?? 'console',
        tenant.id,
        c.mfaState ?? (c.app === 'portal' ? 'not_required' : 'complete'),
        c.expires ?? '7 days',
        c.created ?? '1 minute',
        c.seen ?? '0 minutes',
        c.revoked ?? false,
      ],
    );
    await client.query('SET LOCAL ROLE owner_auth_session_context');
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT c.user_id = $2 AS own_user, c.active_tenant_id, c.app, c.mfa_state,
              c.reauthenticated_at = now() - $3::interval AS reauthenticated,
              pg_catalog.round(pg_catalog.date_part('epoch', c.expires_at - now()) / 60)::integer
                AS ends_in
         FROM auth.session_context($1) AS c`,
      [c.unknownHash ? tokenHash() : hash, user, c.created ?? '1 minute'],
    );
    return rows;
  });
}

describe('auth.session_context()', { timeout: 30_000 }, () => {
  it('returns user, active tenant, app, MFA state, re-authentication and end of a live session', async () => {
    expect(await contextOf({ seen: '1 minute' })).toEqual([
      {
        own_user: true,
        active_tenant_id: tenant.id,
        app: 'console',
        mfa_state: 'complete',
        reauthenticated: true,
        ends_in: 29,
      },
    ]);
  });

  it.each<[string, Case, number]>([
    ['the absolute timeout', { created: '11 hours 50 minutes' }, 10],
    ["Better Auth's expiry", { expires: '5 minutes' }, 5],
    ['the MFA wait', { mfaState: 'verify', created: '4 minutes' }, 6],
    ['the portal idle timeout', { app: 'portal', seen: '1 minute' }, 59],
  ])('ends a session at %s if that comes first', async (_, c, endsIn) => {
    expect(await contextOf(c)).toEqual([expect.objectContaining({ ends_in: endsIn })]);
  });

  it.each<[string, Case]>([
    ['an unknown hash', { unknownHash: true }],
    ['a revoked session', { revoked: true }],
    ['an inactive user', { userStatus: 'deactivated' }],
    ['a console session idle for 31 minutes', { created: '1 hour', seen: '31 minutes' }],
    ['a console session older than 12 hours', { created: '12 hours 1 minute' }],
    [
      'a portal session idle for 61 minutes',
      { app: 'portal', created: '2 hours', seen: '61 minutes' },
    ],
    ['a portal session older than 24 hours', { app: 'portal', created: '24 hours 1 minute' }],
    [
      'a session waiting for MFA set-up for 11 minutes',
      { mfaState: 'enrol', created: '11 minutes' },
    ],
    ['a session waiting for a code for 11 minutes', { mfaState: 'verify', created: '11 minutes' }],
    ["a session past Better Auth's expiry", { created: '2 hours', expires: '-1 minute' }],
  ])('returns nothing for %s', async (_, c) => {
    expect(await contextOf(c)).toEqual([]);
  });

  it.each<[string, Case]>([
    ['a console session idle for 29 minutes', { created: '1 hour', seen: '29 minutes' }],
    ['a console session 11 hours 59 minutes old', { created: '11 hours 59 minutes' }],
    [
      'a portal session idle for 59 minutes',
      { app: 'portal', created: '2 hours', seen: '59 minutes' },
    ],
    ['a portal session 23 hours 59 minutes old', { app: 'portal', created: '23 hours 59 minutes' }],
    ['a session waiting for a code for 9 minutes', { mfaState: 'verify', created: '9 minutes' }],
  ])('still returns %s', async (_, c) => {
    expect(await contextOf(c)).toHaveLength(1);
  });

  it('is callable by app_api alone, which reads a session app_auth wrote', async () => {
    const hash = tokenHash();
    const user = await withClient('app_auth', async (client) => {
      const id = await addUser(client);
      await client.query(
        `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, expires_at)
         VALUES ($1, $2, 'portal', 'not_required', now() + interval '1 day')`,
        [id, hash],
      );
      return id;
    });
    const { rows } = await withClient('app_api', (client) =>
      client.query('SELECT user_id, app FROM auth.session_context($1)', [hash]),
    );
    expect(rows).toEqual([{ user_id: user, app: 'portal' }]);

    for (const role of ['app_worker', 'app_queue', 'app_auth'] as const) {
      await asRoleRolledBack(role, async (client) => {
        expect(await outcome(client, 'SELECT * FROM auth.session_context($1)', [hash]), role).toBe(
          '42501',
        );
      });
    }
  });
});
