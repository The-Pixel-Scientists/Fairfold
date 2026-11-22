// SPDX-License-Identifier: AGPL-3.0-or-later

const format = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });

/** A date as the style guide writes it: "5 January 2027". */
export function dateOf(timestamp: string): string {
  return format.format(new Date(timestamp));
}
