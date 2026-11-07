// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What triage and saved views say, in the words of docs/CONTENT-STYLE.md:
// what is wrong and how to fix it. None repeats a label, a view's name or
// a person. Each is attached with says(), which marks it as written from a
// catalogue, so messageForIssue() shows it on both sides; the server uses
// the last three in its problem details.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const triageMessages = {
  chooseLabel: 'Choose a label to add or remove.',
  addOrRemove: 'Choose to add or to remove each label, not both.',
  viewName: 'Enter a name for the view.',
  columnOnce: 'Add each column once.',
  labelTaken: 'A label with this name already exists. Enter a different name.',
  labelArchived: 'One of the labels is archived. Choose labels that are in use.',
  ownerCannotView: 'The person you chose cannot view applications. Choose someone who can.',
} as const;

export type TriageMessage = (typeof triageMessages)[keyof typeof triageMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: TriageMessage) {
  return { error: message, params: catalogueParams };
}
