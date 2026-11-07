// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the platform says about a note, message, mention or tag, in the words
// of docs/CONTENT-STYLE.md: what is wrong and how to fix it. No message
// repeats a body, a label or the name of anyone mentioned.

import { catalogueParams } from '../platform/messages.ts';

export const notesMessages = {
  enterNote: 'Enter a note.',
  enterMessage: 'Enter a message.',
  enterLabel: 'Enter a label.',
  hiddenCharacters: 'Remove hidden characters, such as text direction marks, then try again.',
  hiddenCharactersLabel: 'Remove line breaks and hidden characters from the label.',
  markup: 'Write plain text without tags in angle brackets, such as <b>, then try again.',
  mentionOnce: 'Mention each person once.',
  mentionNotAllowed:
    'One of the people you mentioned cannot see this application. Remove them and try again.',
} as const;

export type NotesMessage = (typeof notesMessages)[keyof typeof notesMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: NotesMessage) {
  return { error: message, params: catalogueParams };
}
