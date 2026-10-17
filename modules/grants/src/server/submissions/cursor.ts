// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A page cursor is the id of the last submission on the page, as 22
// URL-safe characters. It means nothing until the server finds that
// submission in the caller's tenant.

const HEX_ID = /^[0-9a-f]{32}$/;

export const encodeCursor = (id: string): string =>
  Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');

/** The id a cursor names, or null if it is not one this module wrote. */
export function decodeCursor(cursor: string): string | null {
  const hex = Buffer.from(cursor, 'base64url').toString('hex');
  return HEX_ID.test(hex) && encodeCursor(hex) === cursor
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : null;
}
