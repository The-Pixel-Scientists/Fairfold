// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { consoleSession } from '../testing/api.ts';
import { redirectFor, withQuery } from './redirects.ts';
import type { PageKind } from './redirects.ts';

const ready = (mfa: 'enrol' | 'verify' | 'complete' = 'complete') =>
  ({ status: 'ready', session: consoleSession({ mfa }) }) as const;

describe('withQuery', () => {
  it('adds the page to come back to, unless it is the home page, and the notice', () => {
    expect(withQuery('/sign-in', null)).toBe('/sign-in');
    expect(withQuery('/sign-in', '/')).toBe('/sign-in');
    expect(withQuery('/sign-in', '/programmes?stage=review')).toBe(
      '/sign-in?next=%2Fprogrammes%3Fstage%3Dreview',
    );
    expect(withQuery('/sign-in', null, 'timeout')).toBe('/sign-in?notice=timeout');
    expect(withQuery('/sign-in', '/a', 'timeout')).toBe('/sign-in?next=%2Fa&notice=timeout');
  });
});

describe('redirectFor: nobody signed in', () => {
  const state = { status: 'signed-out', reason: null } as const;

  it('lets visitors stay on the account pages', () => {
    expect(redirectFor('account', state, '/sign-in', null)).toBeNull();
  });

  it('sends them from a console page to sign in, to come back afterwards', () => {
    expect(redirectFor('member', state, '/programmes?stage=review', null)).toBe(
      '/sign-in?next=%2Fprogrammes%3Fstage%3Dreview',
    );
    expect(redirectFor('member', state, '/', null)).toBe('/sign-in');
  });

  it('sends them from the MFA pages to sign in, keeping where they were going', () => {
    expect(redirectFor('verify', state, '/enter-code', '/programmes')).toBe(
      '/sign-in?next=%2Fprogrammes',
    );
    expect(redirectFor('enrol', state, '/set-up-authenticator', null)).toBe('/sign-in');
  });

  it('says why when the session ran out', () => {
    expect(redirectFor('member', { status: 'signed-out', reason: 'timeout' }, '/a', null)).toBe(
      '/sign-in?next=%2Fa&notice=timeout',
    );
  });

  it('opens the signed-out page after sign out, from a console page', () => {
    expect(redirectFor('member', { status: 'signed-out', reason: 'signed-out' }, '/a', null)).toBe(
      '/signed-out',
    );
  });
});

describe('redirectFor: MFA still to do', () => {
  it('sends a session that must set up an authenticator to that page, from everywhere else', () => {
    const state = ready('enrol');
    expect(redirectFor('enrol', state, '/set-up-authenticator', null)).toBeNull();
    expect(redirectFor('member', state, '/programmes', null)).toBe(
      '/set-up-authenticator?next=%2Fprogrammes',
    );
    expect(redirectFor('account', state, '/sign-in', '/programmes')).toBe(
      '/set-up-authenticator?next=%2Fprogrammes',
    );
    expect(redirectFor('verify', state, '/enter-code', null)).toBe('/set-up-authenticator');
  });

  it('sends a session that must enter a code to that page, from everywhere else', () => {
    const state = ready('verify');
    expect(redirectFor('verify', state, '/enter-code', null)).toBeNull();
    expect(redirectFor('member', state, '/', null)).toBe('/enter-code');
    expect(redirectFor('enrol', state, '/set-up-authenticator', '/a')).toBe(
      '/enter-code?next=%2Fa',
    );
  });
});

describe('redirectFor: signed in with MFA done', () => {
  const state = ready();

  it('lets them use the console', () => {
    expect(redirectFor('member', state, '/programmes', null)).toBeNull();
  });

  it('sends them from every other page to where they were going, or home', () => {
    for (const kind of ['account', 'enrol', 'verify'] satisfies PageKind[]) {
      expect(redirectFor(kind, state, '/x', '/programmes'), kind).toBe('/programmes');
      expect(redirectFor(kind, state, '/x', null), kind).toBe('/');
    }
  });
});

describe('redirectFor: while there is nothing to go on', () => {
  it('waits while the session loads or when it could not be read', () => {
    for (const status of ['loading', 'failed'] as const) {
      expect(redirectFor('member', { status }, '/', null)).toBeNull();
    }
  });
});
