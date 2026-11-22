// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { decodeCursor, encodeCursor, PAGE_SIZE, toPage } from './page.ts';

it('reads back the offset a cursor was made from, and none from anything else', () => {
  expect(decodeCursor(undefined)).toBe(0);
  expect(decodeCursor(encodeCursor(50))).toBe(50);
  for (const bad of [
    '',
    '!',
    Buffer.from('-1').toString('base64url'),
    Buffer.from('1e3').toString('base64url'),
  ]) {
    expect(decodeCursor(bad), bad).toBeNull();
  }
});

it('cuts a page and gives a cursor only when a row was left over', () => {
  const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => index);

  const first = toPage(rows, 0);
  expect(first.items).toHaveLength(PAGE_SIZE);
  expect(decodeCursor(first.nextCursor ?? undefined)).toBe(PAGE_SIZE);
  expect(toPage(rows.slice(0, PAGE_SIZE), 50).nextCursor).toBeNull();
});
