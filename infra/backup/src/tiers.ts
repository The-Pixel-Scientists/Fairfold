// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which tier a snapshot belongs to and how long it is locked (ADR 0011).
// Everything is worked out from the snapshot's start in UTC, so clock changes
// and the host's time zone cannot move a date. A lock can be lengthened and
// never shortened: a wrong yearly date costs 7 years of storage.

import { BackupError } from './codes.ts';

export type Tier = 'daily' | 'monthly' | 'yearly';

const DAY_MS = 86_400_000;
const DAILY_DAYS = 35;
const MONTHS: Readonly<Record<Exclude<Tier, 'daily'>, number>> = { monthly: 12, yearly: 84 };

export function tierFor(start: Date): Tier {
  if (start.getUTCDate() !== 1) return 'daily';
  return start.getUTCMonth() === 0 ? 'yearly' : 'monthly';
}

/** A date whole months later; a day the later month lacks rolls forward, never back. */
export function addMonths(start: Date, months: number): Date {
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

export function retainUntil(start: Date, tier: Tier): Date {
  return tier === 'daily'
    ? new Date(start.getTime() + DAILY_DAYS * DAY_MS)
    : addMonths(start, MONTHS[tier]);
}

/**
 * Refuses a date past the snapshot's start plus its tier's period and one day
 * (ADR 0011), the last check before a lock that cannot be undone.
 */
export function assertWithinTier(start: Date, tier: Tier, date: Date): void {
  if (date.getTime() > retainUntil(start, tier).getTime() + DAY_MS) {
    throw new BackupError('retain_date_refused');
  }
}

/** The snapshot's id, which sorts by time and starts with its UTC date. */
export function snapshotIdFor(start: Date, suffix: string): string {
  return `${datePrefix(start)}${start.toISOString().slice(11, 19).replaceAll(':', '')}Z-${suffix}`;
}

/** The start of every snapshot id from this UTC date. */
export function datePrefix(start: Date): string {
  return `${start.toISOString().slice(0, 10).replaceAll('-', '')}T`;
}
