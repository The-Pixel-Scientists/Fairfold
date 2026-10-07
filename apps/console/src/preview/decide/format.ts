// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dates and times as the content style writes them: 2 April 2027, 9:14am.

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

/** `2027-04-02` as `2 April 2027`. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/** `2027-04-02T16:20` as `4:20pm`. */
export function formatTime(iso: string): string {
  const hours = Number(iso.slice(11, 13));
  const minutes = iso.slice(14, 16);
  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'am' : 'pm'}`;
}

/** `2027-04-02T09:14` as `2 April 2027, 9:14am`. */
export function formatWhen(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}
