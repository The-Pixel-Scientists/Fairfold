// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Times as docs/CONTENT-STYLE.md writes them ("2 February 2027 at 9am"), in
// UK time. The API holds UTC; people enter and read Europe/London.

const ZONE = 'Europe/London';
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const zoned = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

function partsOf(utcMs: number): Record<string, number> {
  return Object.fromEntries(
    zoned
      .formatToParts(new Date(utcMs))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
}

/** How far UK time is ahead of UTC at that moment, in milliseconds: 0 or one hour. */
function offsetAt(utcMs: number): number {
  const p = partsOf(utcMs);
  return (
    Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day, p.hour, p.minute) -
    Math.floor(utcMs / 60_000) * 60_000
  );
}

/** "9am", "5:30pm", "12pm" for noon. */
export function clock(hours: number, minutes: number): string {
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const past = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
  return `${String(hour)}${past}${hours < 12 ? 'am' : 'pm'}`;
}

/** "2 February 2027 at 9am", in UK time. */
export function formatMoment(iso: string): string {
  const p = partsOf(Date.parse(iso));
  const month = MONTHS[(p.month ?? 1) - 1] ?? '';
  return `${String(p.day)} ${month} ${String(p.year)} at ${clock(p.hour ?? 0, p.minute ?? 0)}`;
}

/** What a date and time box holds for a UTC moment: `2027-02-02T09:00` in UK time. Empty for none. */
export function toUkInput(iso: string | null): string {
  if (iso === null) return '';
  const p = partsOf(Date.parse(iso));
  const two = (value: number | undefined) => String(value).padStart(2, '0');
  return `${String(p.year)}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/**
 * The UTC moment for a time typed in UK time, as the API takes it, or null
 * for text that is not a date and time. A time the clocks skip is read as an
 * hour later; one they repeat, as the first of the two.
 */
export function fromUkInput(local: string): string | null {
  const match = LOCAL.exec(local);
  if (match === null) return null;
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map((part) => Number(part || 0));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = asUtc - offsetAt(asUtc);
  const utc = asUtc - offsetAt(guess);
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
