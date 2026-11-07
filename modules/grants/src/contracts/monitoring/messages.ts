// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What equality monitoring says, in the words of docs/CONTENT-STYLE.md: what
// is wrong and how to fix it. The definition messages are for staff building
// a monitoring form; the rest are for the applicant. None repeats an answer,
// and none says whether anyone else answered. Each is attached with says(),
// which marks it as written from a catalogue.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const monitoringMessages = {
  fileQuestion: 'Remove this file question. Equality monitoring forms do not take files.',
  identityQuestion: 'Remove this question, or mark it as not identifying the applicant.',
  onlyInTotals: 'Set this question to be seen only in totals.',
  specialCategory: 'Mark this question as special category data.',
  optional: 'Make this question optional. Nobody has to answer equality monitoring questions.',
  preferNotToSay: 'Add a "Prefer not to say" option to this question.',
  fromQuestionSet:
    'Use only the equality monitoring questions provided, with their wording and options unchanged.',
  consent: 'Tick the box to agree to your answers being used for equality monitoring.',
  privacyNotice: 'Refresh the page to read the latest privacy notice, then answer again.',
  formChanged:
    'The questions have changed since you opened them. Refresh the page and answer again.',
  alreadyAnswered:
    'You have already answered. Remove your answers first if you want to change them.',
  closed: 'Equality monitoring for this round has closed. You can still remove your answers.',
} as const;

export type MonitoringMessage = (typeof monitoringMessages)[keyof typeof monitoringMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: MonitoringMessage) {
  return { error: message, params: catalogueParams };
}
