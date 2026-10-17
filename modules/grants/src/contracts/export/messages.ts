// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The export routes' validation messages, in the words of
// docs/CONTENT-STYLE.md. Each is attached with says(), which marks it as
// written from a catalogue, so messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const exportMessages = {
  funderIdentifier: "Enter the funder's identifier from org-id.guide, like GB-CHC-1234567.",
  funderName: "Enter the funder's name as it should be published.",
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  identifierPrefix: 'Enter the prefix 360Giving gave the funder, like 360G-northfield.',
  programmeOrRound: 'Choose a programme or a round, not both.',
} as const;

export type ExportMessage = (typeof exportMessages)[keyof typeof exportMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: ExportMessage) {
  return { error: message, params: catalogueParams };
}
