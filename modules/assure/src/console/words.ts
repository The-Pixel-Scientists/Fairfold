// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registers, matches, reasons and dates in the words the screens use. Nothing
// here says a match is a sanction or a block: a member decides.

import type { MatchOutcome, MatchReason, Registry } from '../contracts/index.ts';

export const registryWords = {
  charity_commission: 'Charity Commission',
  companies_house: 'Companies House',
  oscr: 'OSCR',
  ccni: 'CCNI',
} as const satisfies Record<Registry, string>;

export const statusWords = {
  registered: 'Registered',
  removed: 'Removed',
  active: 'Active',
  dissolved: 'Dissolved',
  in_liquidation: 'In liquidation',
  other: 'Other',
} as const;

export const officerRoleWords = {
  trustee: 'Trustee',
  director: 'Director',
  secretary: 'Secretary',
  person_with_significant_control: 'Person with significant control',
  other: 'Other role',
} as const;

export const outcomeWords = {
  not_a_match: 'Not a match',
  needs_information: 'Needs more information',
  confirmed: 'Confirmed match',
} as const satisfies Record<MatchOutcome, string>;

export const reasonWords = {
  different_name: 'The names are different',
  different_date_of_birth: 'The dates of birth are different',
  different_nationality: 'The nationalities are different',
  different_country: 'The countries are different',
  different_entity_kind: 'One is a person and the other is an organisation',
  identity_unclear: 'It is not clear who this is',
  details_missing: 'Details are missing',
  identity_confirmed: 'The identity is confirmed',
} as const satisfies Record<MatchReason, string>;

export const nameSourceWords = {
  party: 'Party record',
  registered_name: 'Registered name',
  officer: 'Officer or trustee',
} as const;

export const entryKindWords = {
  individual: 'Individual',
  entity: 'Organisation',
  ship: 'Ship',
} as const;

export const statusLabel = (status: 'open' | MatchOutcome): string =>
  status === 'open' ? 'Open' : outcomeWords[status];

/** A lookup older than this is called out of date. */
export const STALE_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

export const daysSince = (iso: string, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));

export const isStale = (iso: string, now?: number): boolean =>
  daysSince(iso, now) > STALE_AFTER_DAYS;

export function age(iso: string, now?: number): string {
  const days = daysSince(iso, now);
  return days === 0 ? 'Today' : days === 1 ? '1 day' : `${String(days)} days`;
}

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

/** "4 March 2024" for `2024-03-04`; a year or a month alone stays as written. */
export function formatDay(date: string): string {
  const [year = '', month, day] = date.split('-');
  if (month === undefined) return year;
  const name = MONTHS[Number(month) - 1] ?? month;
  return day === undefined ? `${name} ${year}` : `${String(Number(day))} ${name} ${year}`;
}

const moment = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "3 December 2026 at 14:05" in the browser's time zone, which is the member's own. */
export function formatMoment(iso: string): string {
  const parts = Object.fromEntries(
    moment.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]),
  );
  return `${parts['day'] ?? ''} ${parts['month'] ?? ''} ${parts['year'] ?? ''} at ${parts['hour'] ?? ''}:${parts['minute'] ?? ''}`;
}

export const percent = (similarity: number): string => `${String(Math.round(similarity * 100))}%`;

export const listOf = (values: readonly string[]): string =>
  values.length === 0 ? 'Not given' : values.join(', ');
