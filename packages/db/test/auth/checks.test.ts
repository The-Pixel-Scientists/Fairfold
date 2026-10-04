// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks on the auth tables (migration 0004), and what app_auth may
// change. Each statement runs as app_auth with a new account's id as $1, and
// is rolled back.

import { describe, expect, it } from 'vitest';

import { outcome } from '../tenants.ts';
import { addUser, asRoleRolledBack, tokenHash } from './fixtures.ts';

const ARGON2ID = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$${'h'.repeat(43)}`;
const SCRYPT = `$scrypt$ln=14,r=16,p=1$${'a'.repeat(22)}$${'b'.repeat(43)}`;
const ENCRYPTED = 'a1'.repeat(60);

/** The SQLSTATE of `statement`, or ok, run as app_auth with a new account's id as $1. */
function asAuth(statement: string, values: unknown[] = []): Promise<string> {
  return asRoleRolledBack('app_auth', async (client) =>
    outcome(client, statement, [await addUser(client), ...values]),
  );
}

describe('auth.user', { timeout: 30_000 }, () => {
  it.each([
    ['app_auth naming the account', `UPDATE auth."user" SET name = 'A' WHERE id = $1`, 'ok'],
    [
      'an address not in lower case',
      `INSERT INTO auth."user" (email) SELECT 'Some@Example.test' WHERE $1::uuid IS NOT NULL`,
      '23514',
    ],
    [
      'a name over 200 characters',
      `UPDATE auth."user" SET name = repeat('a', 201) WHERE id = $1`,
      '23514',
    ],
    [
      'app_auth deactivating an account',
      `UPDATE auth."user" SET status = 'deactivated' WHERE id = $1`,
      '42501',
    ],
    [
      'app_auth changing an address',
      `UPDATE auth."user" SET email = 'x@example.test' WHERE id = $1`,
      '42501',
    ],
    ['app_auth deleting an account', `DELETE FROM auth."user" WHERE id = $1`, '42501'],
  ])('%s', async (_, statement, expected) => {
    expect(await asAuth(statement)).toBe(expected);
  });
});

describe('auth.session', { timeout: 30_000 }, () => {
  const insert = (app: string, mfaState: string, userAgent = 'Firefox') =>
    asAuth(
      `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
      [tokenHash(), app, mfaState, userAgent],
    );

  it.each([
    ['a console session with MFA complete', 'console', 'complete', 'ok'],
    ['a console session waiting for a code', 'console', 'verify', 'ok'],
    ['a portal session without MFA', 'portal', 'not_required', 'ok'],
    ['a console session without MFA', 'console', 'not_required', '23514'],
    ['an unknown app', 'admin', 'complete', '23514'],
    ['an unknown MFA state', 'console', 'skipped', '23514'],
  ])('%s', async (_, app, mfaState, expected) => {
    expect(await insert(app, mfaState)).toBe(expected);
  });

  it('refuses a user agent over 1,024 characters', async () => {
    expect(await insert('portal', 'not_required', 'a'.repeat(1025))).toBe('23514');
  });

  it('refuses a token hash that is not 32 bytes', async () => {
    expect(
      await asAuth(
        `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, expires_at)
         VALUES ($1, $2, 'portal', 'not_required', now() + interval '1 hour')`,
        [tokenHash().subarray(1)],
      ),
    ).toBe('23514');
  });

  it('lets app_auth record use and revocation, but not change what makes it a new session', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      await client.query(
        `INSERT INTO auth.session (user_id, token_hash, app, mfa_state, expires_at)
         VALUES ($1, $2, 'console', 'verify', now() + interval '1 hour')`,
        [await addUser(client), tokenHash()],
      );
      for (const change of [
        "mfa_state = 'complete'",
        'active_tenant_id = NULL',
        'token_hash = token_hash',
        "app = 'portal'",
        'user_id = user_id',
        'created_at = now()',
      ]) {
        expect(await outcome(client, `UPDATE auth.session SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'UPDATE auth.session SET mfa_failures = 6')).toBe('23514');
      for (const change of ['mfa_failures = 5', 'last_seen_at = now()', 'revoked_at = now()']) {
        expect(await outcome(client, `UPDATE auth.session SET ${change}`), change).toBe('ok');
      }
    });
  });
});

describe('auth.account', { timeout: 30_000 }, () => {
  it.each([
    ['an Argon2id password', 'ok', null, 'credential', ARGON2ID],
    ['another provider', '23514', null, 'google', ARGON2ID],
    ['an account id that is not the user id', '23514', 'someone', 'credential', ARGON2ID],
    ['a password in clear', '23514', null, 'credential', 'correct horse battery staple'],
    ['an scrypt hash', '23514', null, 'credential', SCRYPT],
  ])('%s gives %s', async (_, expected, accountId, provider, password) => {
    expect(
      await asAuth(
        `INSERT INTO auth.account (user_id, account_id, provider_id, password)
         VALUES ($1, COALESCE($2, $1::uuid::text), $3, $4)`,
        [accountId, provider, password],
      ),
    ).toBe(expected);
  });
});

describe('auth.verification', { timeout: 30_000 }, () => {
  it.each([
    ['a hashed identifier', 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg', 'ok'],
    ['an email address', 'someone.who.signs.up@example.test', '23514'],
    ['a prefixed raw token', 'reset-password:abcdefghijklmnopqrstuvwxyz012345', '23514'],
  ])('%s', async (_, identifier, expected) => {
    expect(
      await asAuth(
        `INSERT INTO auth.verification (identifier, value, expires_at)
         VALUES ($2, $1::text, now() + interval '1 day')`,
        [identifier],
      ),
    ).toBe(expected);
  });
});

describe('auth.two_factor', { timeout: 30_000 }, () => {
  const insert = 'INSERT INTO auth.two_factor (user_id, secret) VALUES ($1, $2)';

  it.each([
    ['an encrypted secret', 'ok', ENCRYPTED],
    ['an encrypted secret with its key version', 'ok', `$ba$2$${ENCRYPTED}`],
    ['a base32 secret in clear', '23514', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'],
    ['a short value', '23514', 'a1'.repeat(39)],
    ['a value over 2,048 characters', '23514', 'a1'.repeat(1025)],
  ])('%s gives %s', async (_, expected, secret) => {
    expect(await asAuth(insert, [secret])).toBe(expected);
  });

  it('refuses backup codes from app_auth', async () => {
    expect(
      await asAuth(
        'INSERT INTO auth.two_factor (user_id, secret, backup_codes) VALUES ($1, $2, $3)',
        [ENCRYPTED, 'codes'],
      ),
    ).toBe('42501');
  });

  it('starts unverified, and lets app_auth confirm it and record a step, but not lock it', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const { rows } = await client.query(
        `${insert} RETURNING verified, failed_verification_count, locked_until`,
        [await addUser(client), ENCRYPTED],
      );
      expect(rows).toEqual([{ verified: false, failed_verification_count: 0, locked_until: null }]);
      for (const change of ['verified = true', 'last_used_step = 59000000']) {
        expect(await outcome(client, `UPDATE auth.two_factor SET ${change}`), change).toBe('ok');
      }
      for (const change of ['failed_verification_count = 1', 'locked_until = now()']) {
        expect(await outcome(client, `UPDATE auth.two_factor SET ${change}`), change).toBe('42501');
      }
    });
  });
});

describe('auth.rate_limit', { timeout: 30_000 }, () => {
  it.each([
    [
      'an identifier and an IPv4 address',
      'sign_in_identifier_ip',
      'a@example.test',
      '192.0.2.1',
      'ok',
    ],
    ['an IPv6 /64', 'sign_in_ip', null, '2001:db8:1:2::/64', 'ok'],
    ['an IPv6 address inside a /64', 'sign_in_ip', null, '2001:db8:1:2::1/64', '22P02'],
    ['an IPv6 /48', 'sign_in_ip', null, '2001:db8:1::/48', '23514'],
    ['a single IPv6 address', 'sign_in_ip', null, '2001:db8:1:2::1', '23514'],
    ['an IPv4 /24', 'email_ip', null, '192.0.2.0/24', '23514'],
    ['an identifier not normalised', 'sign_in_identifier', 'A@Example.test', null, '23514'],
    ['an identifier on a per-IP counter', 'sign_in_ip', 'a@example.test', '192.0.2.1', '23514'],
    ['no address on a per-IP counter', 'email_ip', null, null, '23514'],
    ['an unknown scope', 'device', 'a@example.test', null, '23514'],
  ])('%s', async (_, scope, identifier, ip, expected) => {
    expect(
      await asAuth(
        `INSERT INTO auth.rate_limit (scope, identifier, client_ip)
         SELECT $2, $3, $4::cidr WHERE $1::uuid IS NOT NULL`,
        [scope, identifier, ip],
      ),
    ).toBe(expected);
  });

  it('keeps one counter per scope, identifier and address', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const add = `INSERT INTO auth.rate_limit (scope, identifier) VALUES ('sign_in_identifier', 'a@example.test')`;
      await client.query(add);
      expect(await outcome(client, add)).toBe('23505');
    });
  });
});
