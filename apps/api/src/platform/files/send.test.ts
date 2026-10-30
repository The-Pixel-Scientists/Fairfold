// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { contentDisposition } from './send.ts';

describe('contentDisposition', () => {
  it('sends an attachment with the name as filename* and an ASCII fallback', () => {
    expect(contentDisposition('Accounts 2025.pdf')).toBe(
      `attachment; filename="Accounts 2025.pdf"; filename*=UTF-8''Accounts%202025.pdf`,
    );
    expect(contentDisposition('Résumé – Zoë.pdf')).toBe(
      `attachment; filename="R_sum_ _ Zo_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20Zo%C3%AB.pdf`,
    );
  });

  it('drops quotes, backslashes and control characters from the fallback', () => {
    const header = contentDisposition('a"b\\c\r\nSet-Cookie: x=1\t.pdf');
    expect(header).toBe(
      `attachment; filename="abcSet-Cookie: x=1.pdf"; filename*=UTF-8''a%22b%5Cc%0D%0ASet-Cookie%3A%20x%3D1%09.pdf`,
    );
    expect(header).not.toMatch(/[\r\n\t]/);
  });

  it('encodes the characters RFC 5987 does not allow unencoded', () => {
    const header = contentDisposition("it's (a) *file*; name=x,y.pdf");
    expect(header.split("filename*=UTF-8''")[1]).toBe(
      'it%27s%20%28a%29%20%2Afile%2A%3B%20name%3Dx%2Cy.pdf',
    );
  });

  it('keeps an emoji or a right-to-left override out of the fallback', () => {
    const header = contentDisposition('\u{1F600}\u{202E}gpj.exe.pdf');
    expect(header.startsWith('attachment; filename="__')).toBe(true);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });
});
