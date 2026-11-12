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
 * A closing time, which is local to its time zone, in words: "5pm on 2 November
 * 2026, UK time". Midday is "midday", and midnight is the end of the day before,
 * so nobody reads it as the start of the next. A time that cannot be read is
 * shown as it came.
 */
export function closingTime(closesAt: string, timeZone: string): string {
  const parts = LOCAL_TIME.exec(closesAt)?.slice(1).map(Number);
  if (parts === undefined) return closesAt;
  const [year = 0, month = 1, date = 1, hours = 0, minutes = 0] = parts;
  const zone = timeZone === 'Europe/London' ? 'UK time' : `${timeZone.replaceAll('_', ' ')} time`;
  if (hours === 0 && minutes === 0) {
    return `midnight at the end of ${day.format(Date.UTC(year, month - 1, date - 1))}, ${zone}`;
  }
  const time = hours === 12 && minutes === 0 ? 'midday' : clock(hours, minutes);
  return `${time} on ${day.format(Date.UTC(year, month - 1, date))}, ${zone}`;
}

interface Closing {
  closesAt?: string | undefined;
  round: { closesAt: string; timeZone: string };
}

/** When this application closes, in words. The server's time for it, not the round's, when it sends one. */
export function deadlineOf({ closesAt, round }: Closing): string {
  return closingTime(closesAt ?? round.closesAt, round.timeZone);
}

/** Whether the application closes later than its round does, which is the only thing said about an extension. */
export function hasMoreTime({ closesAt, round }: Closing): boolean {
  return closesAt !== undefined && closesAt > round.closesAt;
}

const ukMoment = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** A moment the API sent as an ISO time, in UK time whatever the device says: "1 March 2027 at 2:14pm, UK time". */
export function ukTimeOf(iso: string): string {
  const part = Object.fromEntries(
    ukMoment.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]),
  );
  const clockTime = clock(Number(part['hour']), Number(part['minute']));
  return `${part['day'] ?? ''} ${part['month'] ?? ''} ${part['year'] ?? ''} at ${clockTime}, UK time`;
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
