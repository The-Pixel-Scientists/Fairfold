// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breach clock (UK GDPR Article 33(1)): the ICO is told within 72 hours
// of the moment the tenant became aware. Hours are elapsed hours between
// instants, not working hours, so a clock change does not move the deadline.
// Pure: the current time is an argument.

import { privacyMessages, type PrivacyMessage } from './messages.ts';

export const BREACH_NOTICE_HOURS = 72;

const HOUR = 3_600_000;

export interface BreachClock {
  /** The instant the ICO must have been told by. */
  readonly deadline: string;
  /** Whole hours left at `now`, rounded down; 0 once the deadline has passed. */
  readonly hoursRemaining: number;
  /** Told after the deadline, or not told and the deadline has passed. */
  readonly late: boolean;
}

export function breachClock(
  becameAwareAt: string,
  icoNotifiedAt: string | null,
  now: string,
): BreachClock {
  const deadline = Date.parse(becameAwareAt) + BREACH_NOTICE_HOURS * HOUR;
  return {
    deadline: new Date(deadline).toISOString(),
    hoursRemaining: Math.max(0, Math.floor((deadline - Date.parse(now)) / HOUR)),
    late: Date.parse(icoNotifiedAt ?? now) > deadline,
  };
}

/**
 * A message if any of the times is after `now`: nothing is recorded as
 * happening later than it is recorded. The server checks a breach's
 * awareness and discovery times with it when the breach is recorded, its
 * discovery time when it changes, and the time people were told.
 */
export function futureTimeProblem(now: string, ...times: readonly string[]): PrivacyMessage | null {
  return times.some((time) => Date.parse(time) > Date.parse(now))
    ? privacyMessages.timeInFuture
    : null;
}

/**
 * What is wrong with recording the ICO notification at `now`, if anything:
 * it is not in the future or before becoming aware, and a late one needs a
 * reason.
 */
export function icoNotificationProblem(
  becameAwareAt: string,
  notification: { readonly notifiedAt: string; readonly lateReason: string | null },
  now: string,
): PrivacyMessage | null {
  const { notifiedAt, lateReason } = notification;
  const inFuture = futureTimeProblem(now, notifiedAt);
  if (inFuture !== null) return inFuture;
  if (Date.parse(notifiedAt) < Date.parse(becameAwareAt)) {
    return privacyMessages.notifiedBeforeAware;
  }
  const { late } = breachClock(becameAwareAt, notifiedAt, notifiedAt);
  if (late && lateReason === null) return privacyMessages.lateReasonRequired;
  if (!late && lateReason !== null) return privacyMessages.lateReasonNotNeeded;
  return null;
}
