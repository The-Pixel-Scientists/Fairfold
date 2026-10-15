// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether one file suits a file question: the check the browser runs before
// an upload, and the server again (architecture rule 6). Scanning and who
// owns the file are server checks outside the engine.

import type { FileType } from '../files/types.ts';
import type { FileField } from './definition.ts';
import { formMessages as m } from './messages.ts';

/**
 * The message for a file this question refuses, or undefined when it takes
 * it. `type` is what sniffFileType() found in the bytes, or null when it
 * found nothing it knows: never the name's or the browser's type.
 */
export function checkFile(
  field: FileField,
  file: { bytes: number; type: FileType | null },
): string | undefined {
  if (file.bytes > field.maxBytes) return m.fileSize(field.maxBytes);
  if (file.type === null || !field.allowedTypes.includes(file.type)) {
    return m.fileType(field.allowedTypes);
  }
  return undefined;
}
