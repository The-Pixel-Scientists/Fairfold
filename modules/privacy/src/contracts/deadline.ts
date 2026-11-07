// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights request clock (UK GDPR Article 12(3), with the DUAA 2025 "stop
// the clock" rule). Pure: the current date is an argument and no time zone
// is guessed. Dates are calendar dates, `YYYY-MM-DD`, in the tenant's time
// zone; the server derives the received date from the received timestamp
// with calendarDateIn(). Each rule below awaits legal advice (S11-03, C31):
//   - one calendar month runs from the received date to the corresponding
//     date in the next month, or the last day of that month if there is none;
//   - one extension of 1 or 2 further months, counted from the received
//     date, only on or before the deadline it extends;
//   - a pause runs from the day the controller asks for identity proof or
//     clarification to the day the answer arrives, and those days are added
//     to the deadline; an open pause leaves the due date unknown;
//   - an extension or pause is late if it is recorded after the due date as
//     it stood on the day it is dated, so a late one cannot be backdated,
//     even under an open pause, and nothing is dated after the day it is
//     recorded;
//   - a due date on a weekend or a non-working date rolls to the next working
//     day while ROLLS_TO_NEXT_WORKING_DAY is true.

import { privacyMessages, type PrivacyMessage } from './messages.ts';

/**
 * Whether a due date on a weekend or non-working date moves to the next
 * working day, as the ICO's guidance says. Open until legal advice (C31).
 */
export const ROLLS_TO_NEXT_WORKING_DAY: boolean = true;

export const clockStates = ['running', 'paused', 'extended', 'overdue', 'closed'] as const;

export type ClockState = (typeof clockStates)[number];

/**
 * A change to the clock, as the shared function reads it; the routes add a
 * reason code. `on` is the day it happened, as the member entered it, and
 * `recordedOn` the day it was recorded, which the server derives from
 * `recordedAt` in the tenant's time zone.
 */
export type ClockEvent = { readonly on: string; readonly recordedOn: string } & (
  | { readonly kind: 'paused' | 'resumed' | 'closed' }
  | { readonly kind: 'extended'; readonly months: 1 | 2 }
);

/** Why a list of clock events is refused, each with a message in clockRefusalMessages. */
export const clockRefusals = [
  'in_future',
  'before_received',
  'out_of_order',
  'after_close',
  'already_paused',
  'not_paused',
  'resume_before_pause',
  'already_extended',
  'extension_late',
  'pause_late',
] as const;

export type ClockRefusal = (typeof clockRefusals)[number];

export const clockRefusalMessages = {
  in_future: privacyMessages.dateInFuture,
  before_received: privacyMessages.eventBeforeReceived,
  out_of_order: privacyMessages.eventOutOfOrder,
  after_close: privacyMessages.eventAfterClose,
  already_paused: privacyMessages.alreadyPaused,
  not_paused: privacyMessages.notPaused,
  resume_before_pause: privacyMessages.resumeBeforePause,
  already_extended: privacyMessages.alreadyExtended,
  extension_late: privacyMessages.extensionLate,
  pause_late: privacyMessages.pauseLate,
} as const satisfies Record<ClockRefusal, PrivacyMessage>;

export interface ClockInput {
  readonly receivedOn: string;
  /** In the order they were recorded. */
  readonly events: readonly ClockEvent[];
  /** Bank holidays and other days off; weekends are always non-working. */
  readonly nonWorkingDates: ReadonlySet<string>;
  readonly today: string;
}

export type Clock =
  | { readonly ok: true; readonly state: ClockState; readonly dueOn: string | null }
  | { readonly ok: false; readonly refusal: ClockRefusal };

const DAY = 86_400_000;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** The corresponding date `months` later, or the last day of that month if there is none. */
export function addCalendarMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return dateOf(Date.UTC(year, month, Math.min(Number(date.slice(8, 10)), lastDay)) / DAY);
}

/** The date itself if it is a working day, otherwise the next one. */
export function nextWorkingDay(date: string, nonWorkingDates: ReadonlySet<string>): string {
  let day = dayNumber(date);
  const isOff = (d: number) => [0, 6].includes(new Date(d * DAY).getUTCDay());
  while (isOff(day) || nonWorkingDates.has(dateOf(day))) day += 1;
  return dateOf(day);
}

/** The calendar date an instant falls on in a time zone. */
export function calendarDateIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The due date and state of a rights request, or why its events are refused. Never throws. */
export function rightsRequestClock({
  receivedOn,
  events,
  nonWorkingDates,
  today,
}: ClockInput): Clock {
  let pausedDays = 0;
  let pausedOn: string | null = null;
  let months = 0;
  let closedOn: string | null = null;
  let last = receivedOn;

  const dueAsOf = (asOf: string) => {
    const open = pausedOn === null ? 0 : dayNumber(asOf) - dayNumber(pausedOn);
    const due = dateOf(dayNumber(addCalendarMonths(receivedOn, 1 + months)) + pausedDays + open);
    return ROLLS_TO_NEXT_WORKING_DAY ? nextWorkingDay(due, nonWorkingDates) : due;
  };
  const refuse = (refusal: ClockRefusal): Clock => ({ ok: false, refusal });
  const isLate = ({ on, recordedOn }: ClockEvent) => recordedOn > dueAsOf(on);

  if (receivedOn > today) return refuse('in_future');
  for (const event of events) {
    if (event.on > event.recordedOn || event.recordedOn > today) return refuse('in_future');
    if (closedOn !== null) return refuse('after_close');
    if (event.on < receivedOn) return refuse('before_received');
    if (event.kind === 'resumed' && pausedOn !== null && event.on < pausedOn) {
      return refuse('resume_before_pause');
    }
    if (event.on < last) return refuse('out_of_order');
    switch (event.kind) {
      case 'paused':
        if (pausedOn !== null) return refuse('already_paused');
        if (isLate(event)) return refuse('pause_late');
        pausedOn = event.on;
        break;
      case 'resumed':
        if (pausedOn === null) return refuse('not_paused');
        pausedDays += dayNumber(event.on) - dayNumber(pausedOn);
        pausedOn = null;
        break;
      case 'extended':
        if (months > 0) return refuse('already_extended');
        if (isLate(event)) return refuse('extension_late');
        months = event.months;
        break;
      case 'closed':
        closedOn = event.on;
        break;
    }
    last = event.on;
  }

  if (closedOn !== null) return { ok: true, state: 'closed', dueOn: dueAsOf(closedOn) };
  if (pausedOn !== null) return { ok: true, state: 'paused', dueOn: null };
  const dueOn = dueAsOf(today);
  const state = today > dueOn ? 'overdue' : months > 0 ? 'extended' : 'running';
  return { ok: true, state, dueOn };
}
