// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's messages, in the words of docs/CONTENT-STYLE.md: what
// is wrong and how to fix it. None repeats a submitted value. Each is
// attached with says(), which marks it as written from a catalogue, so
// messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const privacyMessages = {
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  listedOnce: 'List each item once.',
  requestKind:
    'Choose the kind of request: access, rectification, erasure, restriction, portability, objection, automated decision or complaint.',
  requestChannel:
    'Choose how the request arrived: email, post, phone, in person, web form, social media or another way.',
  identityCheck:
    'Choose where the identity check is: not started, proof asked for, verified, not needed or failed.',
  summary: 'Enter a short summary of what the person asked for.',
  clockState: 'Choose a status: running, paused, extended, overdue or closed.',
  dueWithinDays: 'Enter a whole number of days from 0 to 366.',
  pauseReason: 'Choose why the clock stops: to confirm identity or to clarify the request.',
  resumeReason:
    'Choose why the clock restarts: the information arrived, or it is no longer needed.',
  extensionReason:
    'Choose why the request needs longer: it is complex, or the person made several requests.',
  extensionMonths: 'Extend by 1 or 2 months.',
  closeReason:
    'Choose how the request ended: completed, refused, withdrawn, or identity not confirmed.',
  dateInFuture: 'Enter a date that is today or earlier.',
  eventBeforeReceived: 'Enter a date on or after the day the request was received.',
  eventOutOfOrder: 'Enter a date on or after the last change to the clock.',
  eventAfterClose: 'This request is closed, so its clock cannot change. Log a new request.',
  alreadyPaused: 'The clock is already stopped. Restart it before stopping it again.',
  notPaused: 'The clock is running. Stop it before restarting it.',
  resumeBeforePause: 'Enter a date on or after the day the clock stopped.',
  alreadyExtended: 'This request has been extended once already, which is the limit.',
  extensionLate: 'The deadline has passed, so the request cannot be extended. Respond now.',
  pauseLate: 'The deadline has passed, so the clock cannot be stopped. Respond now.',
  taskTitle: 'Enter what needs to be done.',
  module: 'Choose a tool from the list, or none.',
  dataCategory: 'Choose the kinds of data from the list.',
  breachDescription: 'Enter what happened.',
  count: 'Enter a whole number of 0 or more, or leave it blank if you do not know.',
  riskLevel: 'Choose the risk to people: unlikely, a risk, or a high risk.',
  icoReference: 'Enter the reference the ICO gave you.',
  lateReason: 'Choose why the ICO was told more than 72 hours after you became aware.',
  lateReasonRequired:
    'The ICO was told more than 72 hours after you became aware. Choose why it was late.',
  lateReasonNotNeeded: 'The ICO was told within 72 hours. Leave the reason for lateness blank.',
  timeInFuture: 'Enter a time that is now or earlier.',
  notifiedBeforeAware: 'Enter a time after you became aware of the breach.',
  notificationMethod: 'Choose how people were told: email, post, phone or in person.',
  dpiaTitle: 'Enter a title for the assessment.',
  dpiaStatus: 'Choose draft or in review. To sign the assessment off, use sign off.',
  screeningAnswer: 'Answer yes, no or not sure.',
  tooManyAnswers: 'Answer no more than 100 screening questions.',
  riskDescription: 'Enter the risk.',
  likelihood: 'Choose how likely the harm is: remote, possible or probable.',
  severity: 'Choose how severe the harm would be: minimal, significant or severe.',
  activityName: 'Enter a name for the processing activity.',
  purpose: 'Enter what the data is used for.',
  legalBasis: 'Choose a lawful basis from the list.',
  specialCategoryCondition: 'Choose a condition for special category data from the list, or none.',
  subjectCategory: 'Choose whose data it is from the list.',
  processorName: 'Enter the name of the processor.',
  processorService: 'Enter what the processor does for you.',
  countryCode: 'Enter a two-letter country code in capitals, such as GB.',
  transferSafeguard: 'Choose how transfers abroad are protected from the list, or none.',
} as const;

export type PrivacyMessage = (typeof privacyMessages)[keyof typeof privacyMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: PrivacyMessage) {
  return { error: message, params: catalogueParams };
}
