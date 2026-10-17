// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading a form from a file into the draft. The file is checked with the same
// contract the server uses, and the server checks the definition again when the
// draft is saved.

import type { FormDefinition } from '@pixel-scientists/domain/forms';

import {
  FORM_DEFINITION_MAX_BYTES,
  formFileSchema,
  formVersionMessages,
} from '../../contracts/index.ts';
import { inWords, problemsOf } from './problems.ts';

export type Imported = { definition: FormDefinition } | { messages: string[] };

const NOT_A_FORM = 'This file is not a form. Choose a form file that was saved from this tool.';

/** The file's definition, or what is wrong with the file, in words. */
export async function readFormFile(file: File): Promise<Imported> {
  // The limit is on the definition's compact text, so a file may be a little larger.
  if (file.size > 2 * FORM_DEFINITION_MAX_BYTES)
    return { messages: [formVersionMessages.tooLarge] };
  let content: unknown;
  try {
    content = JSON.parse(await file.text());
  } catch {
    return { messages: [NOT_A_FORM] };
  }
  const result = formFileSchema.safeParse(content);
  if (result.success) return { definition: result.data.definition };
  const inDefinition = result.error.issues.filter((issue) => issue.path[0] === 'definition');
  const messages = problemsOf(inDefinition, 1).map(inWords);
  return { messages: inDefinition.length < result.error.issues.length ? [NOT_A_FORM] : messages };
}
