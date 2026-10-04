// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { applicantSession } from '../testing/api.ts';
import { redirectFor, withQuery } from './redirects.ts';

const ready = { status: 'ready', session: applicantSession() } as const;

describe('withQuery', () => {
  it('adds the page to come back to, unless it is the home page, and the notice', () => {
    expect(withQuery('/sign-in', null)).toBe('/sign-in');
    expect(withQuery('/sign-in', '/')).toBe('/sign-in');
    expect(withQuery('/sign-in', '/applications?step=2')).toBe(
      '/sign-in?next=%2Fapplications%3Fstep%3D2',
    );
    expect(withQuery('/sign-in', null, 'timeout')).toBe('/sign-in?notice=timeout');
    expect(withQuery('/sign-in', '/a', 'timeout')).toBe('/sign-in?next=%2Fa&notice=timeout');
  });
});

describe('redirectFor: nobody has signed in', () => {
  const state = { status: 'signed-out', reason: null } as const;

  it('lets a visitor stay on the account pages and the open pages', () => {
    expect(redirectFor('account', state, '/sign-in', null, false)).toBeNull();
    expect(redirectFor('open', state, '/', null, false)).toBeNull();
    expect(redirectFor('open', state, '/no/such/page', null, false)).toBeNull();
  });
});

describe('redirectFor: a session that ended on the page', () => {
  it('opens the signed-out page after sign out, from an open page', () => {
    const state = { status: 'signed-out', reason: 'signed-out' } as const;
    expect(redirectFor('open', state, '/', null, true)).toBe('/signed-out');
  });

  it('says why, and keeps the page, when the session timed out', () => {
    const state = { status: 'signed-out', reason: 'timeout' } as const;
    expect(redirectFor('open', state, '/', null, true)).toBe('/sign-in?notice=timeout');
    expect(redirectFor('open', state, '/applications', null, true)).toBe(
      '/sign-in?next=%2Fapplications&notice=timeout',
    );
  });

  it('leaves the account pages alone, so the signed-out page and sign in can show', () => {
    for (const reason of ['signed-out', 'timeout'] as const) {
      expect(redirectFor('account', { status: 'signed-out', reason }, '/x', null, true)).toBeNull();
    }
  });
});

describe('redirectFor: a session that ended before the page opened', () => {
  it.each(['signed-out', 'timeout'] as const)(
    'keeps someone on an open page after %s, so the link to the start page works',
    (reason) => {
      expect(redirectFor('open', { status: 'signed-out', reason }, '/', null, false)).toBeNull();
    },
  );
});

describe('redirectFor: someone signed in', () => {
  it('sends them from the account pages to the funder page, or where they were going', () => {
    expect(redirectFor('account', ready, '/sign-in', null, true)).toBe('/');
    expect(redirectFor('account', ready, '/sign-in', '/applications', true)).toBe('/applications');
  });

  it('keeps them on the open pages', () => {
    expect(redirectFor('open', ready, '/', null, true)).toBeNull();
  });
});

describe('redirectFor: still working it out', () => {
  it('waits while the session loads, and when it could not be read', () => {
    for (const kind of ['account', 'open'] as const) {
      expect(redirectFor(kind, { status: 'loading' }, '/', null, false)).toBeNull();
      expect(redirectFor(kind, { status: 'failed' }, '/', null, false)).toBeNull();
    }
  });
});
