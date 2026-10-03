// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { authEventCodes } from '../auth/events.ts';
import {
  auditActionPattern,
  auditEntityType,
  defineAuditActions,
  isAuditAction,
  platformAuditActions,
  type AuditAction,
} from './audit.ts';

describe('platform audit actions', () => {
  it('are <module>.<entity>.<event> codes, each once', () => {
    for (const action of platformAuditActions) {
      expect(action).toMatch(auditActionPattern);
      expect(action.startsWith('platform.')).toBe(true);
    }
    expect(new Set(platformAuditActions).size).toBe(platformAuditActions.length);
  });

  it('include a tenant copy of every auth event', () => {
    for (const code of authEventCodes) {
      expect(platformAuditActions).toContain(`platform.auth.${code}`);
    }
  });

  it('record accepting an invitation once, as the copy of the auth event', () => {
    expect(platformAuditActions).toContain('platform.auth.invitation_accepted');
    expect(platformAuditActions).not.toContain('platform.invitation.accepted');
  });

  it('name their entity type', () => {
    expect(auditEntityType('platform.membership.suspended')).toBe('platform.membership');
    expect(auditEntityType('platform.auth.sign_in_failed')).toBe('platform.auth');
  });
});

describe('defineAuditActions', () => {
  it('refuses a code for another module, in the wrong form, or listed twice', () => {
    expect(() =>
      defineAuditActions('party', ['grants.decision.released' as AuditAction<'party'>]),
    ).toThrow();
    for (const bad of [
      'party.organisation',
      'party.Organisation.created',
      'party.organisation.created.v1',
    ]) {
      expect(() => defineAuditActions('party', [bad as AuditAction<'party'>])).toThrow();
    }
    expect(() =>
      defineAuditActions('party', ['party.consent.recorded', 'party.consent.recorded']),
    ).toThrow();
  });

  it('returns a valid list unchanged, and adds it to the codes the writer accepts', () => {
    expect(isAuditAction('grants.decision.released')).toBe(false);
    const actions = defineAuditActions('grants', ['grants.decision.released']);
    expect(actions).toEqual(['grants.decision.released']);
    expect(isAuditAction('grants.decision.released')).toBe(true);
    for (const action of platformAuditActions) expect(isAuditAction(action)).toBe(true);
  });

  it('refuses a code another list already defines, but allows the same list again', () => {
    const list = ['grants.round.opened', 'grants.round.closed'] as const;
    expect(defineAuditActions('grants', list)).toEqual(list);
    expect(defineAuditActions('grants', list)).toEqual(list);
    expect(() => defineAuditActions('grants', ['grants.round.opened'])).toThrow(
      'Audit action grants.round.opened is already defined by another list.',
    );
    expect(() => defineAuditActions('platform', ['platform.theme.changed'])).toThrow();
  });

  it('accepts no other value as a code', () => {
    for (const value of ['', 'platform', 'toString', '__proto__', 'platform.theme']) {
      expect(isAuditAction(value)).toBe(false);
    }
  });

  it('adds nothing from a list it refuses', () => {
    const list = ['party.organisation.created', 'party.Bad.code'] as AuditAction<'party'>[];
    expect(() => defineAuditActions('party', list)).toThrow();
    expect(isAuditAction('party.organisation.created')).toBe(false);
  });
});
