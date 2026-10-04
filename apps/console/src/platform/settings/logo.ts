// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checking a logo file before it is sent, with the same code and words the
// API uses on the bytes it receives.

import { LOGO_MAX_BYTES, checkLogo, messages } from '@pixel-scientists/domain/platform';

export interface ChosenLogo {
  /** The file's name, for saying what was chosen. */
  name: string;
  width: number;
  height: number;
  /** The file's bytes as base64, which is how the API takes them. */
  data: string;
}

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

/** The file ready to send, or the words for what is wrong with it. */
export async function readLogo(file: File): Promise<ChosenLogo | { message: string }> {
  // One byte past the limit is enough to know the file is too large without reading all of it.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, LOGO_MAX_BYTES + 1).arrayBuffer());
  } catch {
    return { message: messages.logoUnreadable };
  }
  const checked = checkLogo(bytes);
  if (!checked.ok) return { message: checked.message };
  return { name: file.name, width: checked.width, height: checked.height, data: toBase64(bytes) };
}
