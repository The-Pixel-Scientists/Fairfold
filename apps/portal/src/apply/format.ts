// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dates, times and amounts as the content style guide writes them
// (docs/CONTENT-STYLE.md): "5pm on 2 November 2026, UK time" and "£5,000 to £25,000".

import { formatMoney } from '@pixel-scientists/domain/platform';
import type { Money } from '@pixel-scientists/domain/platform';

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "5pm" on the hour, "5:30pm" otherwise. */
function clock(hours: number, minutes: number): string {
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const past = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
  return `${String(hour)}${past}${hours < 12 ? 'am' : 'pm'}`;
}

/**
 * A round's closing time, which is local to its time zone, in words:
 * "5pm on 2 November 2026, UK time". A time that cannot be read is shown as it came.
 */
export function closingTime(closesAt: string, timeZone: string): string {
  const parts = LOCAL_TIME.exec(closesAt)?.slice(1).map(Number);
  if (parts === undefined) return closesAt;
  const [year = 0, month = 1, date = 1, hours = 0, minutes = 0] = parts;
  const zone = timeZone === 'Europe/London' ? 'UK time' : `${timeZone.replaceAll('_', ' ')} time`;
  return `${clock(hours, minutes)} on ${day.format(Date.UTC(year, month - 1, date))}, ${zone}`;
}

/** The lowest and highest award a round makes: "£5,000 to £25,000", or one amount when they match. */
export function awardRange(minimum: Money, maximum: Money): string {
  return minimum.amountMinor === maximum.amountMinor
    ? formatMoney(minimum)
    : `${formatMoney(minimum)} to ${formatMoney(maximum)}`;
}

/** A moment the API sent as an ISO time, as a date: "1 March 2027". */
export function dateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(Date.parse(iso));
}

/** A moment the API sent as an ISO time, with the time of day: "1 March 2027 at 2:14pm". */
export function dateAndTimeOf(iso: string): string {
  const moment = new Date(iso);
  return `${dateOf(iso)} at ${clock(moment.getHours(), moment.getMinutes())}`;
}
