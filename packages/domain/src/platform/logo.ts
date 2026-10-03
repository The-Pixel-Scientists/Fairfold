// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's logo (ADR 0019): PNG or WebP only, with the type and size read
// from the file's own signature and header, never from its name or declared
// type. SVG, animations and everything else are refused.

import { messages } from './messages.ts';
import type { LogoType } from './theme.ts';

export const LOGO_MAX_BYTES = 200 * 1024;
export const LOGO_MAX_WIDTH = 1200;
export const LOGO_MAX_HEIGHT = 400;

export type LogoCheck =
  { ok: true; type: LogoType; width: number; height: number } | { ok: false; message: string };

interface Header {
  type: LogoType;
  width: number;
  height: number;
  animated: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** An animated PNG declares an `acTL` chunk before its first image data. */
function isAnimatedPng(bytes: Uint8Array, view: DataView): boolean {
  for (let at = 33; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
    const chunk = ascii(bytes, at + 4, at + 8);
    if (chunk === 'acTL') return true;
    if (chunk === 'IDAT' || chunk === 'IEND') return false;
  }
  return false;
}

/** The whole IHDR chunk comes first: length, name, width, height, five more bytes and its CRC. */
function readPng(bytes: Uint8Array, view: DataView): Header | undefined {
  if (bytes.length < 33 || view.getUint32(8) !== 13 || ascii(bytes, 12, 16) !== 'IHDR') {
    return undefined;
  }
  return {
    type: 'image/png',
    width: view.getUint32(16),
    height: view.getUint32(20),
    animated: isAnimatedPng(bytes, view),
  };
}

/** After `RIFF`, the size and `WEBP` comes one of three first chunks, each with its own header. */
function readWebp(bytes: Uint8Array, view: DataView): Header | undefined {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    // A flags byte (0x02 marks an animation), then the canvas width and
    // height minus one, 24 bits each, little-endian.
    const width = 1 + (view.getUint16(24, true) | ((bytes[26] ?? 0) << 16));
    const height = 1 + (view.getUint16(27, true) | ((bytes[29] ?? 0) << 16));
    return { type: 'image/webp', width, height, animated: ((bytes[20] ?? 0) & 0x02) !== 0 };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    // 14 bits each of width and height minus one, after the signature byte.
    const bits = view.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    return { type: 'image/webp', width, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    // A key frame's start code, then 14 bits each of width and height.
    return {
      type: 'image/webp',
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      animated: false,
    };
  }
  return undefined;
}

function readHeader(bytes: Uint8Array): Header | 'unsupported' | 'unreadable' {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    return readPng(bytes, view) ?? 'unreadable';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return readWebp(bytes, view) ?? 'unreadable';
  }
  return 'unsupported';
}

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: messages.logoTooLarge };
  const header = readHeader(bytes);
  if (header === 'unsupported') return { ok: false, message: messages.logoType };
  if (header === 'unreadable' || header.width === 0 || header.height === 0) {
    return { ok: false, message: messages.logoUnreadable };
  }
  if (header.animated) return { ok: false, message: messages.logoAnimated };
  if (header.width > LOGO_MAX_WIDTH || header.height > LOGO_MAX_HEIGHT) {
    return { ok: false, message: messages.logoTooBig };
  }
  return { ok: true, type: header.type, width: header.width, height: header.height };
}
