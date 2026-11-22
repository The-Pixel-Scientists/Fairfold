// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's opening and closing, as instants, in words in UK time whatever the
// device's time zone is (docs/CONTENT-STYLE.md): "5pm on 14 January 2027 (UK time)".

import { clock } from '../apply/format.ts';

const ukParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The moment in words. Midday is "midday", and midnight is the end of the day
 * before, so nobody reads it as the start of the next.
 */
export function ukMoment(iso: string): string {
  const part = Object.fromEntries(
    ukParts.formatToParts(new Date(iso)).map(({ type, value }) => [type, Number(value)]),
  );
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = part;
  if (hour === 0 && minute === 0) {
    return `midnight at the end of ${longDate.format(Date.UTC(year, month - 1, day - 1))} (UK time)`;
  }
  const time = hour === 12 && minute === 0 ? 'midday' : clock(hour, minute);
  return `${time} on ${longDate.format(Date.UTC(year, month - 1, day))} (UK time)`;
}
