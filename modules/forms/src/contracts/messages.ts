// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's messages, in the words of docs/CONTENT-STYLE.md: what
// is wrong and how to fix it. None repeats a submitted value. Each is
// attached with says(), which marks it as written from a catalogue, so
// messageForIssue() shows it on both sides.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const formsMessages = {
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  blank: 'Enter text, not just spaces.',
  definitionTooLarge:
    'This form is larger than 256 KB. Remove questions or shorten text to make it smaller.',
  title: 'Enter a title for the form.',
  respondents: 'Choose who can answer: people who sign in, anyone, or both.',
  closesAfterOpens: 'Enter a closing time after the opening time.',
  anonymousRetention:
    'Keep responses to a form anyone can answer for 12 months or less. Shorten how long they are kept first.',
  previewAudience: 'Choose who to preview the form as: a respondent or staff.',
  typeChanged:
    'This question had another type when it was published. Change it back, or add a new question instead.',
  classificationLowered:
    'This question was published with a higher classification. Set it back, or add a new question instead.',
  anonymousFile:
    'Forms anyone can answer cannot ask for files. Remove this question, or let only people who sign in answer.',
  anonymousAggregate:
    'Forms anyone can answer cannot ask questions only counted in reports. Remove this question, or let only people who sign in answer.',
  responseView:
    'Choose which responses to show: received, sent without the browser check, or spam.',
  responseRoute: 'Choose how the response was sent: signed in or without signing in.',
  spamReason: 'Choose why this response is spam.',
  reference: 'Enter the response reference exactly as it was given to the person who answered.',
  formChangedTitle: 'The form has changed',
  formChanged:
    'This form changed while you were answering. Check your answers, then send your response again.',
  proofInvalidTitle: 'Browser check not finished',
  proofInvalid:
    'We could not finish checking your browser. Wait for the check to finish, then send your response again.',
} as const;

export type FormsMessage = (typeof formsMessages)[keyof typeof formsMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: FormsMessage) {
  return { error: message, params: catalogueParams };
}
