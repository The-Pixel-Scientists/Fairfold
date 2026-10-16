// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up's validation messages, in the words of
// docs/CONTENT-STYLE.md: what is wrong and how to fix it. None repeats a
// submitted value. Each is attached with says(), which marks it as written
// from a catalogue, so messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const programmeMessages = {
  programmeTitle: 'Enter a title for the programme.',
  programmeSummary: 'Enter a summary for applicants.',
  roundTitle: 'Enter a title for the round.',
  stageName: 'Enter a name for the stage.',
  criterionLabel: 'Enter a label for the criterion.',
  subject: 'Enter a subject for the email.',
  body: 'Enter the text of the email.',
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  closesAfterOpens: 'Enter a closing date and time after the opening date and time.',
  amountPositive: 'Enter an amount of more than £0.',
  amountTooLarge: 'Enter an amount of £1,000,000,000 or less.',
  awardMaximum: 'Enter a largest award the same as or more than the smallest award.',
  budget: 'Enter a budget the same as or more than the largest award.',
  stageNamesUnique: 'Give each stage a different name.',
  listedOnce: 'List each one only once.',
  scale: 'Enter a lowest score that is less than the highest score.',
  mergeFields: 'Use only the merge fields listed for this email, written like {{given_name}}.',
} as const;

export type ProgrammeMessage = (typeof programmeMessages)[keyof typeof programmeMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: ProgrammeMessage) {
  return { error: message, params: catalogueParams };
}
