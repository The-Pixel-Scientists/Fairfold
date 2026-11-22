// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Paging for the registers: a cursor is the number of rows already sent, as
// opaque text. The registers are small and change rarely, so a row added
// between two reads at worst repeats or skips one.

export const PAGE_SIZE = 50;

const OFFSET = /^\d{1,6}$/;

export const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset)).toString('base64url');

/** The rows to skip, or null if the cursor is not one a page gave. */
export function decodeCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, 'base64url').toString();
  return OFFSET.test(text) ? Number(text) : null;
}

/** A page of `PAGE_SIZE` from `rows`, which were read one past it, and the cursor for the next. */
export function toPage<T>(rows: readonly T[], offset: number) {
  return {
    items: rows.slice(0, PAGE_SIZE),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(offset + PAGE_SIZE) : null,
  };
}
