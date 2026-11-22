// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a document renderer takes (ADR 0040, ADR 0016): already-projected
// sections of plain text, with no knowledge of grants or any other module,
// so governance can build its own later. Every string is text that is set
// as text, never read as markup or a link, and holds no control or format
// character. The renderer writes the PDF from a model that has passed
// documentModelSchema, and the model carries nothing for the document's
// properties but its title and language: no author, no tenant, no version.

import { z } from 'zod';

const MAX_TEXT = 20_000;

/** One line or paragraph of plain text: no control or format characters, so nothing hides or reorders. */
const text = z
  .string()
  .max(MAX_TEXT)
  .regex(/^[^\p{Cc}\p{Cf}]*$/u);

export const documentBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('heading'), level: z.int().min(3).max(6), text: text.min(1) }),
  z.strictObject({ type: z.literal('paragraph'), text }),
  z.strictObject({ type: z.literal('list'), ordered: z.boolean(), items: z.array(text).min(1) }),
  z
    .strictObject({
      type: z.literal('table'),
      header: z.array(text.min(1)).min(1).max(10),
      rows: z.array(z.array(text).min(1).max(10)).max(500),
    })
    .refine(({ header, rows }) => rows.every((row) => row.length === header.length)),
]);

export type DocumentBlock = z.infer<typeof documentBlockSchema>;

/** One H2 and its blocks, and one bookmark of the same text. */
export const documentSectionSchema = z.strictObject({
  heading: text.min(1).max(200),
  blocks: z.array(documentBlockSchema).max(2000),
});

export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const MAX_SECTIONS = 200;

export const documentModelSchema = z.strictObject({
  /** The H1, the PDF's title and the file's title property. */
  title: text.min(1).max(200),
  sections: z.array(documentSectionSchema).max(MAX_SECTIONS),
});

export type DocumentModel = z.infer<typeof documentModelSchema>;

/** The document's language: UK English. */
export const DOCUMENT_LANGUAGE = 'en-GB';

/**
 * A renderer returns the PDF as a stream of pieces, so no step holds the
 * whole file (S12-19's library behind it). It fails with a code from the
 * worker's closed list, never with the library's own message.
 */
export type DocumentRenderer = (
  model: DocumentModel,
  /** The creation date for the document's properties. */
  createdAt: Date,
) => AsyncIterable<Uint8Array>;

/** The download name: fixed words and the date, nothing about an applicant or programme. */
export function boardPackFileName(date: Date): string {
  return `board-pack-${date.toISOString().slice(0, 10)}.pdf`;
}
