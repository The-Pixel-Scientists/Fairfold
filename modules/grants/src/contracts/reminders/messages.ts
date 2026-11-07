// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What reminder settings say, in the words of docs/CONTENT-STYLE.md: what is
// wrong and how to fix it. Each is attached with says(), which marks it as
// written from a catalogue, so messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const reminderMessages = {
  daysBefore: 'Enter at least one number of days before the closing time.',
  daysBeforeOnce: 'Enter each number of days only once.',
  template: 'Choose the email to send.',
  transactional:
    'Choose an email for applicants and reviewers about their own work, not a newsletter.',
} as const;

export type ReminderMessage = (typeof reminderMessages)[keyof typeof reminderMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: ReminderMessage) {
  return { error: message, params: catalogueParams };
}
