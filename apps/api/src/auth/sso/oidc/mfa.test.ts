// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { providerAssertedMfa, ssoMfaState } from './mfa.ts';

const mapping = { amr: ['mfa', 'hwk'], acr: ['urn:example:loa:2'] };

describe('providerAssertedMfa', () => {
  it('counts a mapped amr or acr value', () => {
    expect(providerAssertedMfa({ amr: ['pwd', 'mfa'] }, mapping)).toBe(true);
    expect(providerAssertedMfa({ acr: 'urn:example:loa:2' }, mapping)).toBe(true);
  });

  it('counts nothing unmapped or missing, and nothing for an empty mapping', () => {
    expect(providerAssertedMfa({ amr: ['pwd'], acr: 'urn:example:loa:1' }, mapping)).toBe(false);
    expect(providerAssertedMfa({}, mapping)).toBe(false);
    expect(providerAssertedMfa({ amr: ['mfa'], acr: 'x' }, { amr: [], acr: [] })).toBe(false);
    expect(providerAssertedMfa({ amr: ['MFA'] }, mapping)).toBe(false);
  });
});

describe('ssoMfaState', () => {
  it('completes only with asserted MFA, and otherwise waits for local MFA', () => {
    expect(ssoMfaState(true, false)).toBe('complete');
    expect(ssoMfaState(false, true)).toBe('verify');
    expect(ssoMfaState(false, false)).toBe('enrol');
  });
});
