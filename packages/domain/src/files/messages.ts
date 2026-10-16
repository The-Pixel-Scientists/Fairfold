// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the platform says about a file, in the words of
// docs/CONTENT-STYLE.md: what happened and what to do. No message repeats a
// name, type or size that was sent.

/** Why a file was not taken (ADR 0047). */
export const fileRefusals = [
  'type_not_allowed',
  'wrong_extension',
  'too_large',
  'too_many',
  'infected',
  'not_checked',
  'scanner_busy',
] as const;

export type FileRefusal = (typeof fileRefusals)[number];

export const fileRefusalMessages: Readonly<Record<FileRefusal, string>> = {
  type_not_allowed:
    'This type of file cannot be uploaded. Save it as one of the types this question takes and try again.',
  wrong_extension:
    'The file name does not match what is in the file. Rename it with the right ending for its type and try again.',
  too_large:
    'This file is too large. Make it smaller than the limit this question gives and try again.',
  too_many: 'This question takes no more files. Remove one before you add another.',
  infected: 'This file has a virus in it, so it was not uploaded. Check the file and try again.',
  not_checked: 'The file could not be checked. If it has a password, remove it and try again.',
  scanner_busy: 'We are checking other files. Wait a minute, then try again.',
};

export const fileNameMessages = {
  characters: 'Rename the file without slashes or hidden characters, then upload it again.',
  length: 'Give the file a name of 1 to 200 characters, then upload it again.',
} as const;
