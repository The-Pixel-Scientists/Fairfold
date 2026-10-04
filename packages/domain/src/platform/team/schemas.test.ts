// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageForIssue, messages } from '../messages.ts';
import {
  consoleRoleSchema,
  invitationSchema,
  inviteSchema,
  memberSchema,
  rolesChangeSchema,
} from './schemas.ts';

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

function firstMessage(result: { error?: { issues: readonly object[] } }): string | undefined {
  const issue = result.error?.issues[0];
  return issue === undefined ? undefined : messageForIssue(issue);
}

describe('team schemas', () => {
  it('offer the console roles only', () => {
    expect(consoleRoleSchema.options).toEqual(['tenant_admin', 'programme_manager', 'reviewer']);
  });

  it('invite by a normalised address with console roles', () => {
    expect(inviteSchema.parse({ email: ' Ada@Example.org ', roles: ['reviewer'] })).toEqual({
      email: 'ada@example.org',
      roles: ['reviewer'],
    });
  });

  it('need at least one role, each once, and never an applicant', () => {
    expect(firstMessage(rolesChangeSchema.safeParse({ roles: [] }))).toBe(messages.chooseRole);
    for (const roles of [['reviewer', 'reviewer'], ['applicant'], ['owner']]) {
      expect(rolesChangeSchema.safeParse({ roles }).success, roles.join()).toBe(false);
    }
  });

  it('refuse keys they do not name', () => {
    const invite = { email: 'a@example.org', roles: ['reviewer'] };
    for (const extra of [{ tenantId: id }, { status: 'active' }, { membershipId: id }]) {
      expect(inviteSchema.safeParse({ ...invite, ...extra }).success).toBe(false);
      expect(rolesChangeSchema.safeParse({ roles: ['reviewer'], ...extra }).success).toBe(false);
    }
  });

  it('show members and invitations without any account field', () => {
    expect(Object.keys(memberSchema.shape)).toEqual(['id', 'name', 'email', 'roles', 'status']);
    expect(Object.keys(invitationSchema.shape)).toEqual(['id', 'email', 'roles', 'expiresAt']);
    const member = {
      id,
      name: null,
      email: 'a@example.org',
      roles: ['reviewer'],
      status: 'active',
    };
    expect(memberSchema.parse({ ...member, mfa: 'complete', sessions: 2 })).toEqual(member);
    expect(memberSchema.safeParse({ ...member, status: 'removed' }).success).toBe(false);
  });
});
