// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../api/route.ts';
import { authEventCodes } from './events.ts';
import * as mfa from './mfa-routes.ts';
import * as auth from './routes.ts';

const routes = Object.values(auth.authRoutes);

describe('auth routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in authRoutes', () => {
    const exported = [...Object.values(auth), ...Object.values(mfa)].filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('match the reviewed list of routes without a permission', async () => {
    const lines = routes.map(
      (route) => `${route.method} ${route.path} (session: ${route.session})`,
    );
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/routes-without-permission.txt',
    );
  });

  it('ask only for an email address to start a sign-up or a password reset', () => {
    for (const route of [auth.startSignUp, auth.requestPasswordReset]) {
      expect(Object.keys(route.body.shape)).toEqual(['email']);
      expect(route.responses).toEqual({ 202: null });
    }
  });

  it('take a token and a new password to finish a sign-up or a password reset', () => {
    for (const route of [auth.completeSignUp, auth.completePasswordReset]) {
      expect(Object.keys(route.body.shape)).toEqual(['token', 'password']);
      expect(route.session).toBe('none');
    }
  });

  it('switch tenant by membership id, never by tenant', () => {
    expect(Object.keys(auth.switchTenant.body.shape)).toEqual(['membershipId']);
  });

  it('let a session waiting for MFA reach only the TOTP routes, sign-out and the session', () => {
    const reach = (session: string) =>
      routes.filter((route) => route.session === session).map((route) => route.path);
    expect(reach('mfa_pending')).toEqual([
      '/auth/totp/enrol',
      '/auth/totp/confirm',
      '/auth/totp/verify',
    ]);
    expect(reach('any')).toEqual(['/auth/sign-out', '/auth/session']);
  });
});

describe('auth event codes', () => {
  it('are snake case, each once, and include the password reset events', () => {
    for (const code of authEventCodes) expect(code).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    expect(new Set(authEventCodes).size).toBe(authEventCodes.length);
    expect(authEventCodes).toEqual(
      expect.arrayContaining([
        'password_reset_requested',
        'password_reset_completed',
        'sessions_revoked',
      ]),
    );
  });
});
