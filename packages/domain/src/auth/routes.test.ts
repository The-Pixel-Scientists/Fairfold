// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { keysOf, schemaNodes, toJsonSchema, type JsonSchema } from '../api/json-schema.ts';
import { checkRoute, type RouteContract } from '../api/route.ts';
import { isRawBody } from '../api/schema-rules.ts';
import * as account from './account-routes.ts';
import * as backupCodes from './backup-code-routes.ts';
import { authEventCodes } from './events.ts';
import * as invitation from './invitation-routes.ts';
import * as mfa from './mfa-routes.ts';
import * as passkey from './passkey-routes.ts';
import * as auth from './routes.ts';
import * as ssoAdmin from './sso-admin-routes.ts';
import * as sso from './sso-routes.ts';

const routes: RouteContract[] = Object.values(auth.authRoutes);
const adminRoutes: RouteContract[] = Object.values(ssoAdmin.ssoAdminRoutes);
const named = Object.entries({ ...auth.authRoutes, ...ssoAdmin.ssoAdminRoutes });

const isRoute = (value: unknown): value is RouteContract =>
  typeof value === 'object' && value !== null && 'audience' in value;

/** Every node of a schema, on both sides; none for a raw body or no body. */
function nodesOf(schema: unknown): JsonSchema[] {
  if (schema === undefined || isRawBody(schema)) return [];
  return (['input', 'output'] as const).flatMap((io) => [
    ...schemaNodes(toJsonSchema(schema as z.ZodType, io)),
  ]);
}

function requestKeys(route: RouteContract): string[] {
  return [route.params, route.query, route.body].flatMap((part) => nodesOf(part).flatMap(keysOf));
}

describe('auth routes', () => {
  it('keep every route rule, as do the SSO administration routes', () => {
    for (const route of [...routes, ...adminRoutes]) {
      expect(checkRoute(route), route.path).toEqual([]);
    }
  });

  it('are all listed in authRoutes, and the SSO administration routes in ssoAdminRoutes', () => {
    const exported = [account, backupCodes, auth, invitation, mfa, passkey, sso, ssoAdmin]
      .flatMap((file): unknown[] => Object.values(file))
      .filter(isRoute);
    expect(new Set(exported.filter((r) => r.audience === 'auth'))).toEqual(new Set(routes));
    expect(new Set(exported.filter((r) => r.audience !== 'auth'))).toEqual(new Set(adminRoutes));
  });

  it('match the reviewed list of routes without a permission', async () => {
    const lines = routes.map((route) => {
      if (route.audience !== 'auth') throw new Error(`${route.path} is not an auth route.`);
      const marks = [
        `session: ${route.session}`,
        ...(route.stepUp === true ? ['step-up'] : []),
        ...(route.ssoCompletion === undefined ? [] : [`sso: ${route.ssoCompletion}`]),
      ];
      return `${route.method} ${route.path} (${marks.join(', ')})`;
    });
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/routes-without-permission.txt',
    );
  });

  it('need step-up for every change to MFA, email, password or SSO settings', () => {
    const stepUp = named.filter(([, route]) => (route as { stepUp?: boolean }).stepUp === true);
    expect(stepUp.map(([name]) => name)).toEqual([
      'generateBackupCodes',
      'startTotpChange',
      'confirmTotpChange',
      'removeTotp',
      'requestEmailChange',
      'changePassword',
      'passkeyRegistrationOptions',
      'addPasskey',
      'removePasskey',
      'addSsoProvider',
      'changeSsoProvider',
      'removeSsoProvider',
      'addSsoDomain',
      'verifySsoDomain',
      'removeSsoDomain',
    ]);
    const reads = adminRoutes.filter((route) => route.method === 'GET');
    expect(reads.every((route) => !('stepUp' in route))).toBe(true);
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

  it('accept an invitation with its token alone, from a complete session', () => {
    expect(Object.keys(invitation.acceptInvitation.body.shape)).toEqual(['token']);
    expect(invitation.acceptInvitation.session).toBe('complete');
  });

  it('switch tenant by membership id, never by tenant', () => {
    expect(Object.keys(auth.switchTenant.body.shape)).toEqual(['membershipId']);
  });

  it('never name a tenant, user, membership or actor in a request', () => {
    // Choosing among the session's own memberships, and the WebAuthn user
    // handle, which the server checks against the credential's owner.
    const allowed = new Set(['membershipId', 'userHandle']);
    for (const route of [...routes, ...adminRoutes]) {
      const keys = requestKeys(route).filter((key) => !allowed.has(key));
      expect(
        keys.filter((key) => /tenant|user|membership|actor/i.test(key)),
        route.path,
      ).toEqual([]);
    }
    expect(requestKeys(auth.switchTenant)).toContain('membershipId');
  });

  it('carry no token or email address in a path or query', () => {
    for (const route of [...routes, ...adminRoutes]) {
      const nodes = [...nodesOf(route.params), ...nodesOf(route.query)];
      expect(
        nodes.some((node) => node['format'] === 'email'),
        route.path,
      ).toBe(false);
      const keys = nodes.flatMap(keysOf);
      expect(
        keys.filter((key) => /token|email/i.test(key)),
        route.path,
      ).toEqual([]);
    }
    expect(account.emailChangeLinkPath).toBe('/email-change');
  });

  it('let a session waiting for MFA reach only the MFA routes, sign-out and the session', () => {
    const reach = (session: string) =>
      routes.filter((route) => 'session' in route && route.session === session).map((r) => r.path);
    expect(reach('mfa_pending')).toEqual([
      '/auth/totp/enrol',
      '/auth/totp/confirm',
      '/auth/totp/verify',
      '/auth/backup-codes/verify',
      '/auth/passkey-mfa/options',
      '/auth/passkey-mfa',
    ]);
    expect(reach('any')).toEqual(['/auth/sign-out', '/auth/session']);
  });

  it('answer a redirect only at the ends of an SSO sign-in, and exempt only the ACS from Origin', () => {
    const redirects = routes.filter((route) => Object.hasOwn(route.responses, 303));
    expect(redirects).toEqual([sso.completeOidc, sso.samlAcs, sso.completeSaml]);
    const exempt = routes.filter((r) => 'ssoCompletion' in r && r.ssoCompletion === 'saml_acs');
    expect(exempt).toEqual([sso.samlAcs]);
    expect(Object.keys(sso.samlAcs.body.shape).sort()).toEqual(['RelayState', 'SAMLResponse']);
  });

  it('answer the same shape from the SSO start, from an email address alone', () => {
    expect(Object.keys(sso.startSso.body.shape)).toEqual(['email']);
    expect(Object.keys(sso.startSso.responses)).toEqual(['200']);
    expect(sso.startSso.responses[200]).toBe(sso.startSsoStepUp.responses[200]);
  });

  it('keep the MVP1 TOTP routes to a session waiting for MFA, and answer 204 to an MFA change', () => {
    expect([mfa.enrolTotp.session, mfa.confirmTotp.session]).toEqual([
      'mfa_pending',
      'mfa_pending',
    ]);
    for (const route of [account.confirmTotpChange, account.removeTotp, account.changePassword]) {
      expect(route.responses, route.path).toEqual({ 204: null });
    }
    expect(Object.keys(account.changePassword.body.shape)).toEqual(['password']);
  });

  it('change an email address by a link to the new one, spent by a POST', () => {
    expect(Object.keys(account.requestEmailChange.body.shape)).toEqual(['email']);
    expect(account.requestEmailChange.responses).toEqual({ 202: null });
    expect(Object.keys(account.completeEmailChange.body.shape)).toEqual(['token']);
    expect(account.completeEmailChange.method).toBe('POST');
  });

  it('show backup codes only when made, and otherwise only how many are left', () => {
    const made = backupCodes.generateBackupCodes.responses[200];
    expect(made.safeParse({ codes: Array(10).fill('abcde-12345') }).success).toBe(true);
    expect(made.safeParse({ codes: Array(9).fill('abcde-12345') }).success).toBe(false);
    expect(Object.keys(backupCodes.countBackupCodes.responses[200].shape)).toEqual(['remaining']);
  });

  it('list passkeys by id, name, and when made and last used, and nothing else', () => {
    const list = passkey.listPasskeys.responses[200].shape.passkeys.element;
    expect(Object.keys(list.shape)).toEqual(['id', 'name', 'createdAt', 'lastUsedAt']);
  });

  it('cap every string a passkey credential carries', () => {
    for (const route of [passkey.addPasskey, passkey.signInWithPasskey, passkey.verifyPasskeyMfa]) {
      const strings = nodesOf(route.body).filter((node) => node['type'] === 'string');
      expect(strings.length, route.path).toBeGreaterThan(0);
      for (const node of strings) {
        expect('maxLength' in node || 'const' in node || 'enum' in node, route.path).toBe(true);
      }
    }
  });

  it('never answer a secret or private key', () => {
    for (const route of [...routes, ...adminRoutes]) {
      for (const body of Object.values(route.responses)) {
        const keys = nodesOf(body).flatMap(keysOf);
        expect(
          keys.filter((key) => /secret|private|password/i.test(key)),
          route.path,
        ).toEqual([]);
      }
    }
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
