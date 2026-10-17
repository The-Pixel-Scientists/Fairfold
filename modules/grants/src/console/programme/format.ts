// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dates, times and amounts as docs/CONTENT-STYLE.md writes them: "1 April
// 2027", "5pm", "£25,000". A round's times are local to its time zone and
// carry no offset, so they are read from the text and never through a Date.

import { formatMoney } from '@pixel-scientists/domain/platform';
import type { Money } from '@pixel-scientists/domain/platform';

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

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "9am", "5:30pm", "12pm" for noon. */
export function clock(hours: number, minutes: number): string {
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const past = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
  return `${String(hour)}${past}${hours < 12 ? 'am' : 'pm'}`;
}

function day(year: string, month: string, date: string): string {
  return `${String(Number(date))} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** The parts of a round's `2027-02-02T09:00`, or null for text of any other form. */
export function splitLocal(local: string): { date: string; time: string } | null {
  const parts = LOCAL.exec(local);
  return parts === null ? null : { date: local.slice(0, 10), time: local.slice(11) };
}

/** "2 February 2027 at 9am" for `2027-02-02T09:00`. */
export function formatLocal(local: string): string {
  const parts = LOCAL.exec(local);
  if (parts === null) return local;
  const [, year = '', month = '', date = '', hours = '', minutes = ''] = parts;
  return `${day(year, month, date)} at ${clock(Number(hours), Number(minutes))}`;
}

/** "2 February 2027" for `2027-02-02T09:00`. */
export function formatLocalDay(local: string): string {
  const parts = LOCAL.exec(local);
  const [, year = '', month = '', date = ''] = parts ?? [];
  return parts === null ? local : day(year, month, date);
}

/** A moment such as a change was saved, in `timeZone` or the browser's own: "2 February 2027 at 9am". */
export function formatMoment(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${day(part('year'), part('month'), part('day'))} at ${clock(Number(part('hour')), Number(part('minute')))}`;
}

/** "£5,000 to £25,000". */
export function formatAwards(minimum: Money, maximum: Money): string {
  return `${formatMoney(minimum)} to ${formatMoney(maximum)}`;
}
