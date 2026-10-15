// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { clearedCookie, hashToken, newToken, readToken, sessionCookie } from './cookies.ts';

describe('session cookies', () => {
  it('are __Host- cookies: Secure, HttpOnly, SameSite=Lax and Path=/, one name per app', () => {
    const token = newToken();
    expect(sessionCookie('console', token)).toBe(
      `__Host-tps_console_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`,
    );
    expect(sessionCookie('portal', token)).toBe(
      `__Host-tps_portal_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`,
    );
    expect(clearedCookie('console')).toBe(
      '__Host-tps_console_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });

  it("read only the app's own cookie", () => {
    const token = newToken();
    const header = `theme=dark; __Host-tps_portal_session=${token}`;
    expect(readToken(header, 'portal')).toBe(token);
    expect(readToken(header, 'console')).toBeUndefined();
    expect(readToken(undefined, 'portal')).toBeUndefined();
  });

  it('give nothing for two cookies of one name, or a value that is not a token', () => {
    const [a, b] = [newToken(), newToken()];
    expect(
      readToken(`__Host-tps_portal_session=${a}; __Host-tps_portal_session=${b}`, 'portal'),
    ).toBeUndefined();
    for (const value of ['', 'short', `${a}"`, 'x'.repeat(129)]) {
      expect(readToken(`__Host-tps_portal_session=${value}`, 'portal')).toBeUndefined();
    }
  });
});

describe('tokens', () => {
  it('are 32 random bytes, kept only as their SHA-256 hash', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toEqual(createHash('sha256').update(token).digest());
  });
});
