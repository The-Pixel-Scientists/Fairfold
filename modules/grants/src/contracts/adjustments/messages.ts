// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What adjustments and assisted submission say, in the words of
// docs/CONTENT-STYLE.md: what is wrong and how to fix it, with times in the
// round's zone (UK time for UK funders). None repeats a submitted value.
// Each is attached with says(), which marks it as written from a catalogue,
// so messageForIssue() shows it on both sides. The server words refusals it
// finds itself, such as a closing time before the round's, from the same
// list.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const adjustmentMessages = {
  closesAt: 'Enter the new closing date and time.',
  closesAfterRound: "Enter a new closing date and time after the round's own closing time.",
  closesInFuture: 'Enter a new closing date and time that has not passed yet.',
  reason: 'Choose a reason for the adjustment.',
  revokeReason: 'Choose why you are removing the adjustment.',
  alreadyRevoked: 'This adjustment has already been removed. Refresh the page to see it.',
  otherOrganisation: 'Choose an application from this organisation, or leave it out.',
  noAlternativeRoute:
    'Give this organisation the alternative route for this round before you start or submit an application for it.',
  notContact: 'Choose a person who is a current contact for this organisation.',
  alreadyApplying:
    'This organisation already has an application in this round. An organisation can have only one, so you cannot start another for them.',
} as const;

export type AdjustmentMessage = (typeof adjustmentMessages)[keyof typeof adjustmentMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: AdjustmentMessage) {
  return { error: message, params: catalogueParams };
}
