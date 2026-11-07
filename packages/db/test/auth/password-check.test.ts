// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breached-password check's state (migration 0034, ADR 0010): an
// account holds a pending check or a breached password, never both, and
// only app_auth writes either; auth.session_context() restricts a session
// whose account holds a breached password to password_change_required once
// MFA is complete, and ends one that has proven no factor; and the setting
// event carries only on or off.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, asMigratorRolledBack, withClient } from '../connect.ts';
import { createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { addUser, asRoleRolledBack, tokenHash } from './fixtures.ts';

const PHC = `$argon2id$v=19$m=19456,t=2,p=1$${'A'.repeat(22)}$${'B'.repeat(43)}`;

type Flag = 'pending' | 'breached' | 'none';

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await createTestTenant();
});

async function addAccount(client: pg.ClientBase, flag: Flag): Promise<string> {
  const user = await addUser(client);
  await client.query(
    `INSERT INTO auth.account (user_id, account_id, provider_id, password,
                               breach_check_pending_since, password_breached_at)
     VALUES ($1::uuid, $1::text, 'credential', $2,
             CASE WHEN $3::text = 'pending' THEN now() END, CASE WHEN $3::text = 'breached' THEN now() END)`,
    [user, PHC, flag],
  );
  return user;
}

/** auth.session_context()'s MFA state for a session as `mfaState` whose account holds `flag`. */
async function stateOf(flag: Flag, mfaState: string, app = 'console') {
  return asMigratorRolledBack(async (client) => {
    const user = await addAccount(client, flag);
    const hash = tokenHash();
    await client.query(
      `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [user, hash, app, tenant.id, mfaState],
    );
    await client.query('SET LOCAL ROLE owner_auth_session_context');
    const { rows } = await client.query<{ mfa_state: string }>(
      'SELECT mfa_state FROM auth.session_context($1)',
      [hash],
    );
    return rows.map((row) => row.mfa_state);
  });
}

describe('the breached-password state', { timeout: 30_000 }, () => {
  it.each<[Flag, string, string, string[]]>([
    ['breached', 'complete', 'console', ['password_change_required']],
    ['breached', 'complete', 'portal', ['password_change_required']],
    ['breached', 'verify', 'console', ['verify']],
    ['breached', 'enrol', 'console', []],
    ['breached', 'not_required', 'portal', []],
    ['pending', 'complete', 'console', ['complete']],
    ['pending', 'not_required', 'portal', ['not_required']],
    ['none', 'complete', 'console', ['complete']],
  ])('gives a %s account in %s (%s) the session state %j', async (flag, mfa, app, expected) => {
    expect(await stateOf(flag, mfa, app)).toEqual(expected);
  });

  it('refuses an account that holds both flags', async () => {
    await asMigratorRolledBack(async (client) => {
      const user = await addAccount(client, 'pending');
      expect(
        await outcome(
          client,
          'UPDATE auth.account SET password_breached_at = now() WHERE user_id = $1',
          [user],
        ),
      ).toBe('23514');
    });
  });

  it('keeps the flags to credential accounts', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conname = 'account_breach_state_credential'`,
      ),
    );
    expect(rows).toEqual([
      {
        definition:
          "CHECK (((provider_id = 'credential'::text) OR ((breach_check_pending_since IS NULL) AND (password_breached_at IS NULL))))",
      },
    ]);
  });

  it('lets app_auth alone write the flags, and insert only a pending one', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || p.privilege || ' ' || c.name AS right
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest($2::text[]) AS c(name)
          CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
          WHERE pg_catalog.has_column_privilege(r.name, 'auth.account', c.name, p.privilege)
          ORDER BY 1`,
        [APP_ROLES, ['breach_check_pending_since', 'password_breached_at']],
      ),
    );
    expect(rows.map(({ right }) => right)).toEqual([
      'app_auth INSERT breach_check_pending_since',
      'app_auth UPDATE breach_check_pending_since',
      'app_auth UPDATE password_breached_at',
    ]);
  });

  it('records the setting as on or off, with no user, tenant, identifier or address', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const insert = (columns: string, values: string) =>
        outcome(
          client,
          `INSERT INTO auth.audit_event (request_id, code, ${columns})
           VALUES ($1, 'password_check_setting_changed', ${values})`,
          [randomUUID()],
        );
      expect(await insert('reason', "'off'")).toBe('ok');
      for (const [columns, values] of [
        ['reason', "'maybe'"],
        ['reason, tenant_id', `'on', '${tenant.id}'`],
        ['reason, identifier', "'on', 'someone@example.test'"],
        ['reason, ip_address', "'on', '203.0.113.9'"],
      ] as const) {
        expect(await insert(columns, values), columns).toBe('23514');
      }
    });
  });
});
