// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a round's form takes: a whole definition, checked by the form engine
// and within a size limit, saved from the builder or imported from a file.
// Its text follows programme set-up's rule (programme/text.ts): trimmed, not
// empty, and free of characters that hide or reorder text. Postgres also
// refuses NUL.

import { formDefinitionSchema, type FormDefinition } from '@pixel-scientists/domain/forms';
import { catalogueParams } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { programmeMessages } from '../programme/messages.ts';

/**
 * The largest definition: 256 KB of JSON, measured as the UTF-8 bytes of its
 * compact text (JSON.stringify) once parsed, which is what is stored.
 * `grants.form_version` keeps the same limit as a backstop on `definition::text`,
 * which adds a space after each colon and comma, so its check allows twice
 * this.
 */
export const FORM_DEFINITION_MAX_BYTES = 256 * 1024;

export function definitionBytes(definition: unknown): number {
  return new TextEncoder().encode(JSON.stringify(definition)).length;
}

export const formVersionMessages = {
  tooLarge: 'This form is larger than 256 KB. Remove questions or shorten text to make it smaller.',
  blank: 'Enter text, not just spaces.',
} as const;

/** Keys of one-line text in a definition, and of text that may run over several lines. */
const LINE_KEYS = ['title', 'label', 'rowNoun'];
const TEXT_KEYS = ['introduction', 'hint', 'body', 'explanation'];

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

type Path = (string | number)[];

/** A copy of a definition with each text value replaced by what `visit` gives back. */
function mapTexts(
  value: unknown,
  path: Path,
  visit: (text: string, oneLine: boolean, path: Path) => string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => mapTexts(item, [...path, index], visit));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const at = [...path, key];
      const oneLine = LINE_KEYS.includes(key);
      return typeof item === 'string' && (oneLine || TEXT_KEYS.includes(key))
        ? [key, visit(item, oneLine, at)]
        : [key, mapTexts(item, at, visit)];
    }),
  );
}

function textMessage(text: string, oneLine: boolean): string | undefined {
  if (oneLine && HIDDEN.test(text)) return programmeMessages.hiddenCharacters;
  if (!oneLine && HIDDEN_IN_TEXT.test(text)) return programmeMessages.hiddenCharactersText;
  return text === '' ? formVersionMessages.blank : undefined;
}

/** A definition the form engine accepts, with tidy text, within FORM_DEFINITION_MAX_BYTES. */
export const formDefinitionInputSchema = formDefinitionSchema
  .overwrite(
    (definition) =>
      mapTexts(definition, [], (text, oneLine) =>
        (oneLine ? text : text.replace(/\r\n?/g, '\n')).trim(),
      ) as FormDefinition,
  )
  .superRefine((definition, context) => {
    mapTexts(definition, [], (text, oneLine, path) => {
      const message = textMessage(text, oneLine);
      if (message !== undefined) {
        context.addIssue({ code: 'custom', path, message, params: catalogueParams });
      }
      return text;
    });
  })
  .refine((definition) => definitionBytes(definition) <= FORM_DEFINITION_MAX_BYTES, {
    error: formVersionMessages.tooLarge,
    params: catalogueParams,
  });

/** Saving a draft replaces its whole definition. */
export const formDraftInputSchema = z.strictObject({ definition: formDefinitionInputSchema });

export type FormDraftInput = z.infer<typeof formDraftInputSchema>;

/**
 * A form as a file, for importing a definition into a draft. The console
 * reads the file with this schema and saves its definition, which the
 * server checks again.
 */
export const formFileSchema = z.strictObject({
  format: z.literal('form-definition'),
  formatVersion: z.literal(1),
  definition: formDefinitionInputSchema,
});

export type FormFile = z.infer<typeof formFileSchema>;
