// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words on each sign-in screen suit a reading age of about 11 (docs/CONTENT-STYLE.md):
// short sentences, buttons that say what happens, and no apology or blame.

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { applicantSession, signedOut, stubApi } from '../testing/api.ts';
import { openPortal, sentencesIn, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';

const screens = [
  ['the start page', '/northfield/'],
  ['create an account', '/northfield/sign-up'],
  ['check your email', '/northfield/sign-up/check-email'],
  ['set your password', `/northfield/sign-up/complete#token=${TOKEN}`],
  ['a link that does not work', '/northfield/sign-up/complete'],
  ['sign in', '/northfield/sign-in?notice=timeout'],
  ['forgot your password', '/northfield/forgot-password'],
  ['the reset email has been sent', '/northfield/forgot-password/sent'],
  ['choose a new password', `/northfield/reset-password#token=${TOKEN}`],
  ['signed out', '/northfield/signed-out'],
  ['page not found', '/northfield/no-such-page'],
] as const;

describe.each(screens)('%s', (_name, path) => {
  it('keeps every sentence short, and never apologises or blames the person', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal(path);
    await screen.findByRole('heading', { level: 1 });

    for (const sentence of sentencesIn(screen.getByRole('main'))) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    }
    expect(screen.getByRole('main').textContent).not.toMatch(/sorry|apolog|your fault|invalid/i);
  });

  it('uses buttons and links that say what happens, never a bare "Submit" or "OK"', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal(path);
    await screen.findByRole('heading', { level: 1 });

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(control.textContent).not.toMatch(/^(submit|ok|click here|here|next)$/i);
    }
  });
});

describe('the signed-in pages', () => {
  it.each([
    ['an applicant', applicantSession()],
    ['an account that cannot apply here', applicantSession({ active: null })],
  ])('keep every sentence short for %s', async (_name, session) => {
    stubApi({ 'GET /auth/session': { status: 200, body: session } });
    openPortal('/northfield/');
    await screen.findByRole('heading', { level: 1 });

    for (const sentence of sentencesIn(screen.getByRole('main'))) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    }
  });
});
