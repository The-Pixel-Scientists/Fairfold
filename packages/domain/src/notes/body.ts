// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Note and message bodies, mentions and tag labels (ADR 0030). Bodies are
// plain text that people write, so personal data: they never go in a URL,
// audit value, event, job payload, problem detail or email. A schema refuses
// a value that breaks a rule, never cleans it up beyond trimming and turning
// each line break into `\n`.

import { z } from 'zod';

import { idSchema, type Id } from '../id.ts';
import type { FieldProblem } from '../platform/messages.ts';
import { notesMessages, says, type NotesMessage } from './messages.ts';

/** The limits S12-13's checks repeat. Counted in UTF-16 units, so never looser than the database. */
export const MAX_NOTE_LENGTH = 5000;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_TAG_LABEL_LENGTH = 40;
export const MAX_MENTIONS = 10;

/**
 * Control characters other than tab and line break, lone surrogates, line
 * and paragraph separators, and the marks that set or reorder text direction.
 */
const HIDDEN = /(?![\t\n])[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
/** What a body may hold but which shows nothing: whitespace and zero-width characters. */
const INVISIBLE = /[\s\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
/** Something written as a tag, such as `<b>`, `</p>` or `<!--`; a lone `<` is fine. */
const MARKUP = /<[a-z!/][^<>]*>/i;

function body(max: number, empty: NotesMessage) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(notesMessages.hiddenCharacters))
    .refine((value) => value.replace(INVISIBLE, '') !== '', says(empty))
    .refine((value) => !MARKUP.test(value), says(notesMessages.markup));
}

export const noteBodySchema = body(MAX_NOTE_LENGTH, notesMessages.enterNote);

export const messageBodySchema = body(MAX_MESSAGE_LENGTH, notesMessages.enterMessage);

/**
 * Members a note mentions, by membership id: never parsed out of the body,
 * so a body cannot mention someone, and a renamed member stays mentioned.
 */
export const mentionsSchema = z
  .array(idSchema)
  .max(MAX_MENTIONS)
  .refine((ids) => new Set(ids).size === ids.length, says(notesMessages.mentionOnce));

/**
 * A tag's label: one short line, unique in its tenant in any case (S12-13).
 * Labels are tenant configuration and must not name people.
 */
export const tagLabelSchema = z
  .string()
  .trim()
  .max(MAX_TAG_LABEL_LENGTH)
  .refine(
    (value) => !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value),
    says(notesMessages.hiddenCharactersLabel),
  )
  .refine((value) => value !== '', says(notesMessages.enterLabel));

/**
 * The mentions `allowed` refuses, each at its place in the request body,
 * with words that name no one. `allowed` is every active member who holds
 * the permission to see the record, which the server reads at write time in
 * the request's tenant (rule 6); never a list the browser sent.
 */
export function checkMentions(mentions: readonly Id[], allowed: ReadonlySet<Id>): FieldProblem[] {
  return mentions.flatMap((id, index) =>
    allowed.has(id)
      ? []
      : [{ field: `body.mentions.${index}`, message: notesMessages.mentionNotAllowed }],
  );
}
