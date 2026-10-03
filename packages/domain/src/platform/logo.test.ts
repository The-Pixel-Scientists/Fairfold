// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkLogo, LOGO_MAX_BYTES } from './logo.ts';
import { messages } from './messages.ts';

function bytes(...parts: (number[] | string)[]): Uint8Array {
  return Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string'
        ? Array.from({ length: part.length }, (_, i) => part.charCodeAt(i))
        : part,
    ),
  );
}

const u32be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];

function png(width: number, height: number): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes(
    signature,
    u32be(13),
    'IHDR',
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0],
    [0, 0, 0, 0],
  );
}

function webp(chunk: string, header: number[]): Uint8Array {
  return bytes('RIFF', u32le(4 + 8 + header.length), 'WEBP', chunk, u32le(header.length), header);
}

const vp8x = (w: number, h: number, flags = 0) =>
  webp('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const vp8l = (w: number, h: number) => webp('VP8L', [0x2f, ...u32le((w - 1) | ((h - 1) << 14))]);
const vp8 = (w: number, h: number) =>
  webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]);

/** A PNG chunk: length, name, data and a CRC (not checked, so zeros). */
function chunk(name: string, data: number[]): number[] {
  return [...bytes(u32be(data.length), name, data, [0, 0, 0, 0])];
}

function padded(image: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(image);
  return out;
}

describe('checkLogo', () => {
  it('reads the type and size of a PNG and of each kind of WebP', () => {
    expect(checkLogo(png(1200, 400))).toEqual({
      ok: true,
      type: 'image/png',
      width: 1200,
      height: 400,
    });
    for (const image of [vp8x(600, 200), vp8l(600, 200), vp8(600, 200)]) {
      expect(checkLogo(image)).toEqual({ ok: true, type: 'image/webp', width: 600, height: 200 });
    }
  });

  it('takes the type from the bytes, so a PNG named as WebP is read as a PNG', () => {
    const renamed = { name: 'logo.webp', type: 'image/webp', bytes: png(300, 100) };
    expect(checkLogo(renamed.bytes)).toMatchObject({ ok: true, type: 'image/png' });
  });

  it('refuses SVG and every other type', () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF');
    const gif = bytes('GIF89a', [1, 0, 1, 0]);
    const wave = bytes('RIFF', u32le(4), 'WAVE');
    for (const file of [svg, jpeg, gif, wave, new Uint8Array(0)]) {
      expect(checkLogo(file)).toEqual({ ok: false, message: messages.logoType });
    }
  });

  it('refuses a truncated or malformed header', () => {
    const header = [...png(300, 100)];
    const truncatedPng = png(300, 100).subarray(0, 20);
    const withoutCrc = png(300, 100).subarray(0, 32);
    const truncatedWebp = vp8x(300, 100).subarray(0, 26);
    const wrongChunk = bytes(header.slice(0, 12), 'IDAT', header.slice(16));
    const zeroWidth = png(0, 100);
    for (const file of [truncatedPng, withoutCrc, truncatedWebp, wrongChunk, zeroWidth]) {
      expect(checkLogo(file)).toEqual({ ok: false, message: messages.logoUnreadable });
    }
  });

  it('refuses an animated PNG or WebP', () => {
    const header = [...png(300, 100)];
    const apng = bytes(header, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), chunk('IDAT', [1]));
    const animatedWebp = vp8x(300, 100, 0x02);
    for (const file of [apng, animatedWebp]) {
      expect(checkLogo(file)).toEqual({ ok: false, message: messages.logoAnimated });
    }
  });

  it('reads PNG chunks only up to the image data, and stops at a chunk past the end', () => {
    const header = [...png(300, 100)];
    const stillPng = bytes(header, chunk('tEXt', [65]), chunk('IDAT', [1]), chunk('acTL', [0]));
    const hugeChunk = bytes(header, u32be(0xffffffff), 'tEXt');
    for (const file of [stillPng, hugeChunk]) {
      expect(checkLogo(file)).toMatchObject({ ok: true, type: 'image/png' });
    }
  });

  it('refuses an image wider than 1200 or taller than 400 pixels', () => {
    for (const image of [png(1201, 400), png(1200, 401), vp8x(4000, 4000), vp8l(1300, 100)]) {
      expect(checkLogo(image)).toEqual({ ok: false, message: messages.logoTooBig });
    }
  });

  it('refuses a file over 200 KB before reading it', () => {
    expect(checkLogo(padded(png(300, 100), LOGO_MAX_BYTES))).toMatchObject({ ok: true });
    expect(checkLogo(padded(png(300, 100), LOGO_MAX_BYTES + 1))).toEqual({
      ok: false,
      message: messages.logoTooLarge,
    });
  });
});
