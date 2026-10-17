// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round opens and closes on the wall clock of the tenant's time zone, and
// the database keeps instants. The same local time is a different instant
// each side of a clock change, so the round's zone is recorded with it and
// local times are always read back in that zone.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const clocks = new Map<string, Intl.DateTimeFormat>();

function clockIn(zone: string): Intl.DateTimeFormat {
  let clock = clocks.get(zone);
  if (clock === undefined) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    clocks.set(zone, clock);
  }
  return clock;
}

/** What a clock in `zone` shows at `instant`, in the milliseconds it would be if the zone were UTC. */
function wallClock(zone: string, instant: number): number {
  const shown = new Map(
    clockIn(zone)
      .formatToParts(instant)
      .map(({ type, value }) => [type, Number(value)]),
  );
  const part = (type: Intl.DateTimeFormatPartTypes): number => shown.get(type) ?? Number.NaN;
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
}

/**
 * The instant at which a clock in `zone` shows `local` (`2027-02-02T09:00`),
 * or null if it never does: a time the clocks skip going forward, or a date
 * that is not on the calendar. A time shown twice as the clocks go back is
 * the first of the two.
 */
export function instantAt(zone: string, local: string): Date | null {
  const wall = Date.parse(`${local}:00Z`);
  if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 16) !== local) return null;
  // The zone's offset a day either side of the time holds on either side of any clock change.
  const offsets = [wall - DAY, wall + DAY].map((day) => wallClock(zone, day) - day);
  const shown = offsets
    .map((offset) => wall - offset)
    .filter((instant) => wallClock(zone, instant) === wall);
  return shown.length === 0 ? null : new Date(Math.min(...shown));
}

/** What a clock in `zone` shows at `instant`, as `2027-02-02T09:00`. */
export function localAt(zone: string, instant: Date): string {
  return new Date(wallClock(zone, instant.getTime())).toISOString().slice(0, 16);
}
