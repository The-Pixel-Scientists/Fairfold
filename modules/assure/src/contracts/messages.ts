// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's validation messages, in the words of
// docs/CONTENT-STYLE.md: what is wrong and how to fix it. Each is attached
// with says(), which marks it as written from a catalogue, so
// messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const assureMessages = {
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  listedOnce: 'List each item once.',
  registry: 'Choose a register: Charity Commission, Companies House, OSCR or CCNI.',
  matchStatus: 'Choose a status: open, not a match, needs information or confirmed.',
  matchOutcome: 'Choose whether this is not a match, needs more information, or is confirmed.',
  matchReason: 'Choose a reason from the list.',
  reasonForOutcome: 'Choose a reason that fits your decision.',
  flagReason: 'Choose why this flag is not a problem.',
  checklistName: 'Enter a name for the checklist.',
  itemLabel: 'Enter the check this item asks for.',
  answerKind: 'Choose the kind of answer: yes or no, a date, short text or a file.',
  yesNo: 'Choose yes, no or not applicable.',
  answerText: 'Enter an answer.',
  tooManyAnswers: 'Answer no more than 100 items.',
  visitType: 'Choose how the visit took place: in person, by video call or by phone.',
  followUp: 'Enter the action to follow up.',
  caption: 'Enter a caption that says what the file shows.',
} as const;

export type AssureMessage = (typeof assureMessages)[keyof typeof assureMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: AssureMessage) {
  return { error: message, params: catalogueParams };
}
