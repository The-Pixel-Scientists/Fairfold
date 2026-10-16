// SPDX-License-Identifier: AGPL-3.0-or-later
//
// File names (ADR 0047). A name often names a person, so it travels only in
// the `File-Name` request header, percent-encoded, and never in a URL, a log
// line or an audit event. A name that breaks a rule is refused, never
// changed: what is stored is what the person chose.

import { z } from 'zod';

import { catalogueParams } from '../platform/messages.ts';
import { fileNameMessages } from './messages.ts';
import { fileTypeExtensions, type FileType } from './types.ts';

/** The request header an upload's name travels in. */
export const fileNameHeader = 'File-Name';

export const MAX_FILE_NAME_LENGTH = 200;

/**
 * Control, format (such as right-to-left overrides), line and paragraph
 * separator characters, lone surrogates (which have no UTF-8 form), and both
 * path separators.
 */
const REFUSED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}/\\]/u;

/** 1 to MAX_FILE_NAME_LENGTH characters, each counted once however many UTF-16 units it takes. */
const LENGTH = /^.{1,200}$/su;

/** Characters percent-encoding leaves as they are, and `%XX`: nothing else is a valid header value. */
const ENCODED = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+$/;

/** Up to 4 UTF-8 bytes a character, 3 characters a byte. */
const MAX_HEADER_LENGTH = MAX_FILE_NAME_LENGTH * 12;

/** Checked before trimming, so a refused character at either end is refused, not trimmed away. */
export const fileNameSchema = z
  .string()
  .refine((name) => !REFUSED.test(name), {
    message: fileNameMessages.characters,
    params: catalogueParams,
    abort: true,
  })
  .trim()
  .refine((name) => LENGTH.test(name), {
    message: fileNameMessages.length,
    params: catalogueParams,
  });

/**
 * True when the name ends with one of the type's extensions, in any case.
 * The server refuses a mismatch (`wrong_extension`) after sniffFileType(),
 * because the stored name is the download name and a computer opens a file
 * by its extension: `Budget.hta` with bytes that start `%PDF-` would run as
 * a program.
 */
export function fileNameMatchesType(name: string, type: FileType): boolean {
  const lower = name.toLowerCase();
  return fileTypeExtensions[type].some((extension) => lower.endsWith(extension));
}

/** A name `fileNameSchema` accepts, as UTF-8 percent-encoded for the `File-Name` header. */
export function encodeFileNameHeader(name: string): string {
  return encodeURIComponent(name);
}

/** The name in a `File-Name` header, or null if it is missing, not valid UTF-8, or a name `fileNameSchema` refuses. */
export function decodeFileNameHeader(header: string | undefined): string | null {
  if (header === undefined || header.length > MAX_HEADER_LENGTH || !ENCODED.test(header)) {
    return null;
  }
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch {
    return null;
  }
  const parsed = fileNameSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
}
