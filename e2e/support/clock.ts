// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dates and times in the funder's time zone, worked out from now so that a
// round is open whenever the journey runs: the way the round form takes them,
// the way the round contract takes them (`2026-11-13T17:00`, no offset) and the
// way the pages word them. The demo's own round ran from 12 October to
// 2 November; the journey's opens ten days ago and closes in three weeks.

const ZONE = 'Europe/London';

function parts(at: Date): Record<string, string> {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return Object.fromEntries(formatted.map(({ type, value }) => [type, value]));
}

/** London's wall clock `minutes` from now, to the minute, as `YYYY-MM-DDTHH:mm`. */
export function londonLocal(minutes: number): string {
  const { year, month, day, hour, minute } = parts(new Date(Date.now() + minutes * 60_000));
  return `${year ?? ''}-${month ?? ''}-${day ?? ''}T${hour ?? ''}:${minute ?? ''}`;
}

export interface Moment {
  day: string;
  month: string;
  year: string;
  /** `HH:mm`, as the time box takes it. */
  time: string;
  /** As the console's round page words it, such as `12 October 2026 at 9am`. */
  words: string;
  /** As the portal words a closing time, such as `5pm on 2 November 2026, UK time`. */
  ukTime: string;
}

/** `days` from now in London, at a whole hour, as the round form takes it. */
export function londonMoment(days: number, hour: number): Moment {
  const at = new Date(Date.now() + days * 86_400_000);
  const part = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, ...options }).format(at);
  const day = part({ day: 'numeric' });
  const hours = String(hour % 12 === 0 ? 12 : hour % 12);
  const ampm = hour < 12 ? 'am' : 'pm';
  const month = part({ month: 'long' });
  const year = part({ year: 'numeric' });
  return {
    day,
    month: String(Number(part({ month: 'numeric' }))),
    year,
    time: `${String(hour).padStart(2, '0')}:00`,
    words: `${day} ${month} ${year} at ${hours}${ampm}`,
    ukTime: `${hours}${ampm} on ${day} ${month} ${year}, UK time`,
  };
}
