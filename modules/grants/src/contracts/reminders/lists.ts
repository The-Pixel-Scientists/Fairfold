// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reminders' checked lists, with the words the console shows. The database
// checks the same values, so adding one is a contract change and a
// migration. Reminders only remind (rule 9): no value here changes an
// application, an assignment or a decision.

import { z } from 'zod';

/** A draft whose effective closing time is near, or a review past its due point. */
export const reminderKinds = {
  draft_closing: 'Application closing soon',
  review_overdue: 'Review overdue',
} as const;

export type ReminderKind = keyof typeof reminderKinds;

export const reminderKindSchema = z.enum(
  Object.keys(reminderKinds) as [ReminderKind, ...ReminderKind[]],
);

/** What happened to a reminder that is due. */
export const reminderOutcomes = {
  sent: 'Sent',
  skipped: 'Not sent',
  failed: 'Could not be sent',
} as const;

export type ReminderOutcome = keyof typeof reminderOutcomes;

export const reminderOutcomeSchema = z.enum(
  Object.keys(reminderOutcomes) as [ReminderOutcome, ...ReminderOutcome[]],
);

/** Why a reminder was not sent, or could not be. */
export const reminderReasons = {
  superseded: 'A later reminder was sent instead',
  not_needed: 'The application was submitted or the review was finished',
  switched_off: 'Reminders or grants were switched off',
  closed: 'The application had closed',
  no_recipient: 'Nobody could be emailed',
  delivery_failed: 'The email could not be delivered',
} as const;

export type ReminderReason = keyof typeof reminderReasons;

export const reminderReasonSchema = z.enum(
  Object.keys(reminderReasons) as [ReminderReason, ...ReminderReason[]],
);
