// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { noticeText, type AccountNotice } from './notices.ts';

const notices: AccountNotice[] = ['totp_changed', 'totp_removed', 'password_changed'];

describe('account change notices', () => {
  it.each(notices)('%s says when, says what to do, and holds no link', (notice) => {
    const { subject, text } = noticeText(notice, new Date('2026-11-13T09:05:00Z'));
    expect(subject).not.toMatch(/sorry|https?:/i);
    expect(text).toContain('13 November 2026 at 09:05 UTC');
    expect(text).toContain('reset your password from the sign-in page');
    expect(text).not.toMatch(/https?:|www\.|sorry/i);
  });
});
