// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { platformAuditActions } from '../audit.ts';
import { auditActionLabel } from './label.ts';

describe('auditActionLabel', () => {
  it('names a code in plain words', () => {
    expect(auditActionLabel('grants.decision.released')).toBe('Decision released');
    expect(auditActionLabel('platform.membership.roles_changed')).toBe('Membership roles changed');
    expect(auditActionLabel('platform.auth.sign_in_failed')).toBe('Sign-in failed');
    expect(auditActionLabel('platform.auth.mfa_enrolled')).toBe('MFA enrolled');
  });

  it('never shows a defined code raw', () => {
    for (const code of platformAuditActions) {
      expect(auditActionLabel(code), code).toMatch(/^[A-Z][A-Za-z -]*[a-z]$/);
    }
  });

  it('matches the reviewed labels', async () => {
    const lines = platformAuditActions.map((code) => `${code}: ${auditActionLabel(code)}`);
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot('./__snapshots__/labels.txt');
  });

  it('returns a string that is not a code as it is', () => {
    expect(auditActionLabel('not a code')).toBe('not a code');
  });
});
