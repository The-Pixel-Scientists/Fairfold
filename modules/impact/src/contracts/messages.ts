// SPDX-License-Identifier: AGPL-3.0-or-later
//
// impact's messages, in the words of docs/CONTENT-STYLE.md: what is wrong
// and how to fix it. None repeats a submitted value. Validation messages are
// attached with says(), which marks them as written from a catalogue, so
// messageForIssue() shows them on both sides. Refusals are the detail of a
// problem the server answers.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const impactMessages = {
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  listedOnce: 'List each item once.',
  frameworkName: 'Enter a name for the framework.',
  outcomeName: 'Enter a name for the outcome.',
  indicatorName: 'Enter a name for the indicator.',
  outcomes: 'Add from 1 to 50 outcomes.',
  indicators: 'Add up to 150 indicators.',
  indicatorOutcome: 'Choose an outcome from this framework for each indicator.',
  unit: 'Choose a unit: a count, people, a percentage, money, hours or another number.',
  direction: 'Choose whether a higher or a lower figure is better.',
  aggregation: 'Choose how to combine results: add them up, average them or take the latest.',
  periodOrder: 'Enter an end date the same as or after the start date.',
  wholeNumber: 'Enter a whole number.',
  percentage: 'Enter a percentage from 0 to 100, with up to 2 decimal places.',
  decimalPlaces: 'Enter a number with up to 2 decimal places.',
  caption: 'Enter a caption that says what the file shows.',
  note: 'Enter the learning note.',
} as const;

export type ImpactMessage = (typeof impactMessages)[keyof typeof impactMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: ImpactMessage) {
  return { error: message, params: catalogueParams };
}

/** The detail of each problem impact's routes answer, all 409. */
export const impactRefusals = {
  archived: 'This framework is archived. Make a new framework to change it or record results.',
  indicatorInUse:
    "This indicator has results or targets, so it can't be removed. Remove those first, or keep the indicator.",
  unitFixed:
    "An indicator's unit can't be changed once it has results or targets. Add a new indicator instead.",
  targetExists:
    'This indicator already has a target for this programme and period. Change that target instead.',
  valueForUnit: "This figure doesn't fit the indicator's unit. Check the unit and enter it again.",
} as const;
