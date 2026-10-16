// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What anyone is shown about a stored file, and its scan states (ADR 0047).

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { fileTypes, MAX_FILE_BYTES } from './types.ts';

/**
 * A file as the console and portal see it. Strict, and never more: no
 * storage key, hash, uploader, tenant or scan detail, which are for the
 * server alone.
 */
export const fileViewSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  /** The type sniffFileType() found, never the one the browser declared. */
  type: z.enum(fileTypes),
  bytes: z.int().min(1).max(MAX_FILE_BYTES),
  uploadedAt: z.iso.datetime(),
});

export type FileView = z.infer<typeof fileViewSchema>;

/** A file is `pending` only while its upload request runs, then one final state. */
export const scanStates = ['pending', 'clean', 'infected', 'error'] as const;

export type ScanState = (typeof scanStates)[number];

/** Only a clean file is ever sent to anyone. */
export function isDownloadable(state: ScanState): boolean {
  return state === 'clean';
}
