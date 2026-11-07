// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The parts of an email change that need no database: the token's stored
// form, the emails, and routes that carry no token or address in a URL.

import {
  completeEmailChange,
  emailChangeLinkPath,
  requestEmailChange,
} from '@pixel-scientists/domain/auth';
import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { newToken } from '../cookies.ts';
import { tokenId } from '../sign-up.ts';
import { changedText, confirmedText, confirmText, takenText } from './emails.ts';
import { tokenIdentifier } from './token.ts';

describe('the email change token', () => {
  const identify = tokenIdentifier(new Secret('a synthetic auth secret for the tests'));

  it('is kept as an HMAC under its own key, in the form auth.verification takes', () => {
    const token = newToken();
    expect(identify(token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(identify(token)).toBe(identify(token));
    expect(identify(token)).not.toBe(tokenId(token));
    expect(tokenIdentifier(new Secret('another synthetic auth secret'))(token)).not.toBe(
      identify(token),
    );
  });
});

describe('the email change routes', () => {
  it('take the address and the token only in a body', () => {
    for (const contract of [requestEmailChange, completeEmailChange]) {
      expect(contract.method).toBe('POST');
      expect(contract.path).not.toMatch(/[:?]/);
      expect('params' in contract).toBe(false);
      expect('query' in contract).toBe(false);
    }
  });

  it('send links to a page that reads the token from the fragment', () => {
    const link = `https://apply.example.org/northfield${emailChangeLinkPath}#token=abc`;
    expect(confirmText(link).text).toContain(link);
    expect(new URL(link).search).toBe('');
  });
});

describe('the email change emails', () => {
  const at = new Date('2026-11-19T09:30:00Z');

  it('tell the old address when, with no link and no new address', () => {
    const { subject, text } = changedText(at);
    expect(subject).toMatch(/email address .* was changed/);
    expect(text).toContain('19 November 2026 at 09:30 UTC');
    expect(text).not.toMatch(/https?:|@/);
  });

  it('tell an address with an account how to sign in, never who asked', () => {
    const { text } = takenText('https://apply.example.org/northfield');
    expect(text).toContain('https://apply.example.org/northfield/sign-in');
    expect(text).toContain('https://apply.example.org/northfield/forgot-password');
    expect(text).not.toContain('@');
  });

  it('confirm the change to the new address with no link', () => {
    expect(confirmedText().text).not.toMatch(/https?:/);
  });

  it('never apologise', () => {
    const texts = [confirmText('x'), takenText('x'), changedText(at), confirmedText()];
    for (const { subject, text } of texts) expect(`${subject} ${text}`).not.toMatch(/sorry/i);
  });
});
