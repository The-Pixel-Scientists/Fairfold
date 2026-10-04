// SPDX-License-Identifier: AGPL-3.0-or-later

import { LOGO_MAX_BYTES, messages } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { readLogo } from './logo.ts';
import { file, pngHeader } from './testing.ts';

describe('readLogo', () => {
  it('gives the size and the bytes as base64 for a logo that passes', async () => {
    const read = await readLogo(file(pngHeader(120, 40)));

    expect(read).toMatchObject({ name: 'logo.png', width: 120, height: 40 });
    expect('data' in read && atob(read.data).length).toBe(33);
  });

  it('gives the words the API gives for a file that does not pass', async () => {
    expect(await readLogo(file('not an image'))).toEqual({ message: messages.logoType });
    expect(await readLogo(file(pngHeader(1201, 100)))).toEqual({ message: messages.logoTooBig });
    expect(await readLogo(file(new Uint8Array(LOGO_MAX_BYTES + 1)))).toEqual({
      message: messages.logoTooLarge,
    });
    const animation = [0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(await readLogo(file(pngHeader(100, 100, animation)))).toEqual({
      message: messages.logoAnimated,
    });
  });
});
