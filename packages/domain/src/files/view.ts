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

/**
 * A file is `pending` only while its upload request runs, then gets one
 * verdict. A clean file a later scan flags is `withheld` until a scan
 * passes it again or a person deletes it (ADR 0030).
 */
export const scanStates = ['pending', 'clean', 'withheld', 'infected', 'error'] as const;

export type ScanState = (typeof scanStates)[number];

/** Each state in words, for staff screens and reports. */
export const scanStateLabels: Readonly<Record<ScanState, string>> = {
  pending: 'Being checked',
  clean: 'Checked',
  withheld: 'Held back',
  infected: 'Virus found',
  error: 'Could not be checked',
};

/** Only a clean file is ever sent to anyone. */
export function isDownloadable(state: ScanState): boolean {
  return state === 'clean';
}
