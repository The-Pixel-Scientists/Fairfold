// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { requestProblems } from '../api/schema-rules.ts';
import { messages } from '../platform/messages.ts';
import {
  currentPasswordSchema,
  emailSchema,
  passwordSchema,
  sessionSchema,
  tokenSchema,
  totpCodeSchema,
} from './schemas.ts';

function firstMessage(result: { error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe('auth input schemas', () => {
  it('take an email address of up to 254 characters', () => {
    expect(emailSchema.safeParse('ada@example.org').success).toBe(true);
    expect(firstMessage(emailSchema.safeParse('not an address'))).toBe(messages.email);
    const long = `${'a'.repeat(64)}@${['b', 'c', 'd', 'e'].map((c) => c.repeat(60)).join('.')}.org`;
    expect(firstMessage(emailSchema.safeParse(long))).toBe(messages.emailTooLong);
  });

  it('trim and lower-case an email address before checking it', () => {
    expect(emailSchema.parse('  Ada.Lovelace@Example.ORG ')).toBe('ada.lovelace@example.org');
    expect(firstMessage(emailSchema.safeParse('   '))).toBe(messages.email);
  });

  it('mark an email address so it never goes in a URL', () => {
    const lookup = z.strictObject({ address: emailSchema });
    expect(requestProblems('/console/people', 'query', lookup)).toEqual([
      'query holds an email address; a URL carries ids only.',
    ]);
  });

  it('take a new password of 12 to 256 characters', () => {
    expect(passwordSchema.safeParse('correct horse').success).toBe(true);
    expect(firstMessage(passwordSchema.safeParse('short'))).toBe(messages.passwordTooShort);
    expect(firstMessage(passwordSchema.safeParse('x'.repeat(257)))).toBe(messages.passwordTooLong);
  });

  it('take any current password up to 256 characters, so sign-in reveals no rules', () => {
    expect(currentPasswordSchema.safeParse('short').success).toBe(true);
    expect(firstMessage(currentPasswordSchema.safeParse(''))).toBe(messages.enterPassword);
  });

  it('take a link token of 20 to 128 URL-safe characters', () => {
    expect(tokenSchema.safeParse('A1b2-C3d4_E5f6G7h8I9j0K').success).toBe(true);
    for (const token of [
      'short',
      'has space in it, here',
      'x'.repeat(129),
      'abc/def+ghi=jkl.mnop',
    ]) {
      expect(firstMessage(tokenSchema.safeParse(token))).toBe(messages.linkNotValid);
    }
  });

  it('take a six-digit TOTP code', () => {
    expect(totpCodeSchema.safeParse('012345').success).toBe(true);
    for (const code of ['12345', '1234567', '12 345', 'abcdef']) {
      expect(firstMessage(totpCodeSchema.safeParse(code))).toBe(messages.totpCode);
    }
  });
});

describe('sessionSchema', () => {
  const session = {
    user: { id: '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90', email: 'ada@example.org' },
    app: 'console',
    mfa: 'complete',
    expiresAt: '2026-10-12T09:30:00Z',
    recentAuthUntil: null,
    activeMembership: {
      id: '7d4c2b1a-0e9f-4a8b-8c7d-6e5f4a3b2c1d',
      tenant: { slug: 'northfield', name: 'Northfield Community Trust' },
      roles: ['programme_manager'],
    },
    permissions: ['grants.decisions.release'],
    memberships: [],
  };

  const pending = {
    ...session,
    mfa: 'verify',
    activeMembership: null,
    permissions: [],
    memberships: [],
  };
  const portal = {
    ...session,
    app: 'portal',
    mfa: 'not_required',
    activeMembership: { ...session.activeMembership, roles: ['applicant'] },
    permissions: ['grants.applications.apply'],
  };
  const noTenant = { ...session, activeMembership: null, permissions: [] };

  it('describes each kind of session in full, and drops anything else', () => {
    for (const each of [session, pending, portal, noTenant]) {
      expect(sessionSchema.parse({ ...each, tokenHash: 'x' })).toEqual(each);
    }
  });

  it('refuses an unknown MFA state, role or permission', () => {
    expect(sessionSchema.safeParse({ ...session, mfa: 'skipped' }).success).toBe(false);
    const unknown = { ...session, permissions: ['everything'] };
    expect(sessionSchema.safeParse(unknown).success).toBe(false);
    const owner = { ...session.activeMembership, roles: ['owner'] };
    expect(sessionSchema.safeParse({ ...session, activeMembership: owner }).success).toBe(false);
  });

  it('gives a session waiting for MFA no tenant, permission or membership', () => {
    for (const change of [
      { activeMembership: session.activeMembership },
      { permissions: ['grants.decisions.release'] },
      { memberships: [session.activeMembership] },
      { recentAuthUntil: '2026-10-12T09:30:00Z' },
      { app: 'portal' },
    ]) {
      expect(sessionSchema.safeParse({ ...pending, ...change }).success).toBe(false);
    }
  });

  it('gives a session without an active membership no permissions', () => {
    const permitted = { ...noTenant, permissions: ['grants.decisions.release'] };
    expect(sessionSchema.safeParse(permitted).success).toBe(false);
    const applicant = { ...portal, activeMembership: null };
    expect(sessionSchema.safeParse(applicant).success).toBe(false);
    expect(sessionSchema.safeParse({ ...applicant, permissions: [] }).success).toBe(true);
  });

  it('shows each app only memberships with its own roles', () => {
    const staffRole = { ...portal.activeMembership, roles: ['programme_manager'] };
    expect(sessionSchema.safeParse({ ...portal, activeMembership: staffRole }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...portal, memberships: [staffRole] }).success).toBe(false);
    const applicantRole = { ...session.activeMembership, roles: ['applicant'] };
    expect(sessionSchema.safeParse({ ...session, memberships: [applicantRole] }).success).toBe(
      false,
    );
  });

  it('keeps each app to its own permissions and MFA state', () => {
    const staffInPortal = { ...portal, permissions: ['grants.decisions.release'] };
    expect(sessionSchema.safeParse(staffInPortal).success).toBe(false);
    const applicantInConsole = { ...session, permissions: ['grants.applications.apply'] };
    expect(sessionSchema.safeParse(applicantInConsole).success).toBe(false);
    expect(sessionSchema.safeParse({ ...session, mfa: 'not_required' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...portal, mfa: 'complete' }).success).toBe(false);
  });
});
