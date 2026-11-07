// SPDX-License-Identifier: AGPL-3.0-or-later
//
// When an application closes: the one place the rule lives, so the
// `open_round` scope resolver, submitting, the lateness flag, reminders and
// the portal cannot disagree. Times are instants (stored in UTC); a round's
// zone is used only to word them.
//
// An application closes at the latest closing time of its live deadline
// extensions, or at its round's own closing time when it has none. An
// extension applies to an application when it is for the same round and
// organisation, and names that application or none. It is live while it is
// not revoked and its closing time has not passed. An application is closed
// from that instant on: open while `now < effectiveClosingTime(...)`, so an
// application submitted inside its extension is not late, and one submitted
// at the closing second is.

import type { AdjustmentKind } from './lists.ts';

/** What the rule reads from an adjustment, as stored. */
export interface AdjustmentTiming {
  readonly roundId: string;
  readonly organisationId: string;
  readonly applicationId: string | null;
  readonly kind: AdjustmentKind;
  /** Set for a deadline extension only. */
  readonly closesAt: Date | null;
  readonly revoked: boolean;
}

/** An application, or one about to start (with no id yet), and its round's own closing time. */
export interface ApplicationTiming {
  readonly roundId: string;
  readonly organisationId: string;
  readonly id: string | null;
  readonly roundClosesAt: Date;
}

/** A deadline extension in the round that is not revoked. */
function extendsRound(
  adjustment: AdjustmentTiming,
  roundId: string,
): adjustment is AdjustmentTiming & {
  closesAt: Date;
} {
  return (
    adjustment.kind === 'deadline_extension' &&
    !adjustment.revoked &&
    adjustment.closesAt !== null &&
    adjustment.roundId === roundId
  );
}

/** A deadline extension not revoked, for the application's organisation and for it or none. */
function extendsApplication(
  adjustment: AdjustmentTiming,
  application: ApplicationTiming,
): adjustment is AdjustmentTiming & { closesAt: Date } {
  return (
    extendsRound(adjustment, application.roundId) &&
    adjustment.organisationId === application.organisationId &&
    (adjustment.applicationId === null || adjustment.applicationId === application.id)
  );
}

/** When the application closes, as of `now` (the database's clock on the server). */
export function effectiveClosingTime(
  application: ApplicationTiming,
  adjustments: readonly AdjustmentTiming[],
  now: Date,
): Date {
  let closes = application.roundClosesAt;
  for (const adjustment of adjustments) {
    if (!extendsApplication(adjustment, application)) continue;
    if (adjustment.closesAt > now && adjustment.closesAt > closes) closes = adjustment.closesAt;
  }
  return closes;
}

/**
 * When a round closes for equality monitoring (ADR 0032): the later of its
 * own closing time and the last closing time of any extension in it that is
 * not revoked, whether or not it has passed. The server enforces this; it is
 * never shown, since it would tell an applicant that another organisation
 * has an adjustment, and until when.
 */
export function monitoringClosingTime(
  round: { readonly id: string; readonly closesAt: Date },
  adjustments: readonly AdjustmentTiming[],
): Date {
  let closes = round.closesAt;
  for (const adjustment of adjustments) {
    if (extendsRound(adjustment, round.id) && adjustment.closesAt > closes)
      closes = adjustment.closesAt;
  }
  return closes;
}

/**
 * When equality monitoring closes as the applicant is told: the later of
 * the round's own closing time and the application's own extensions not
 * revoked, whether or not they have passed. Other organisations' extensions
 * never count, so this is never after monitoringClosingTime() and reveals
 * nobody else's adjustment.
 */
export function shownMonitoringClosingTime(
  application: ApplicationTiming,
  adjustments: readonly AdjustmentTiming[],
): Date {
  let closes = application.roundClosesAt;
  for (const adjustment of adjustments) {
    if (extendsApplication(adjustment, application) && adjustment.closesAt > closes)
      closes = adjustment.closesAt;
  }
  return closes;
}

/**
 * A closing time in words, on the wall clock of `timeZone`: "5pm UK time on
 * 1 April 2027", "9:30am UK time on 2 November 2026". Midnight is worded as
 * the start of its day, so nobody reads it as the end.
 */
export function closingTimeWords(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts['day']} ${parts['month']} ${parts['year']}`;
  const zone = timeZone === 'Europe/London' ? 'UK time' : `${timeZone} time`;
  const hour = Number(parts['hour']);
  const minute = parts['minute'] === '00' ? '' : `:${parts['minute']}`;
  if (hour === 0 && minute === '') return `midnight ${zone} at the start of ${date}`;
  if (hour === 12 && minute === '') return `midday ${zone} on ${date}`;
  return `${hour % 12 || 12}${minute}${hour < 12 ? 'am' : 'pm'} ${zone} on ${date}`;
}
