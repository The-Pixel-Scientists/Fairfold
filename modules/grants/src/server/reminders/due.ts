// SPDX-License-Identifier: AGPL-3.0-or-later
//
// When reminders fall due. Times are instants; Europe/London is used only to
// step whole calendar days, so a reminder keeps its local clock time across
// the change to or from British Summer Time. A draft's reminders are counted
// back from its effective closing time (effectiveClosingTime(), never
// worked out again here); a review's forward from when it was assigned.

import { MAX_OVERDUE_REMINDERS } from '../../contracts/index.ts';

const DAY_MS = 86_400_000;

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** The London wall clock at `at`, read as if it were UTC. */
function wallClock(at: Date): number {
  const p = Object.fromEntries(clock.formatToParts(at).map((part) => [part.type, +part.value]));
  const n = (type: string): number => p[type] ?? 0;
  return (
    Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) +
    at.getUTCMilliseconds()
  );
}

/** The instant whose London wall clock reads `wall`; a time that does not exist moves forward. */
function fromWallClock(wall: number): Date {
  const guess = wall - (wallClock(new Date(wall)) - wall);
  return new Date(wall - (wallClock(new Date(guess)) - guess));
}

/** `at` moved by whole London calendar days, negative for earlier, at the same London clock time. */
export function addLondonDays(at: Date, days: number): Date {
  return fromWallClock(wallClock(at) + days * DAY_MS);
}

/** One reminder that falls due: its occurrence key and when. */
export interface Due {
  readonly occurrence: number;
  readonly dueAt: Date;
}

/** A draft's reminders: one for each number of days before it closes, keyed by that number. */
export function draftDue(closesAt: Date, daysBefore: readonly number[]): Due[] {
  return daysBefore.map((days) => ({ occurrence: days, dueAt: addLondonDays(closesAt, -days) }));
}

/** An assignment's reminders: the first after `afterDays`, then one every `everyDays`, keyed 1, 2, 3. */
export function reviewDue(assignedAt: Date, afterDays: number, everyDays: number): Due[] {
  return Array.from({ length: MAX_OVERDUE_REMINDERS }, (_, index) => ({
    occurrence: index + 1,
    dueAt: addLondonDays(assignedAt, afterDays + index * everyDays),
  }));
}

/**
 * What to do when `now` finds some reminders due: send the latest one due
 * and record any earlier one as superseded, so a setting switched on late or
 * a worker outage never sends a run of emails.
 */
export function plan(
  due: readonly Due[],
  now: Date,
): { readonly send: number | null; readonly superseded: readonly number[] } {
  const reached = due.filter(({ dueAt }) => dueAt <= now).sort((a, b) => +b.dueAt - +a.dueAt);
  const [latest, ...earlier] = reached;
  return {
    send: latest?.occurrence ?? null,
    superseded: earlier.map(({ occurrence }) => occurrence),
  };
}
