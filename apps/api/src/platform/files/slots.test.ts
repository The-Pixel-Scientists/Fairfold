// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createSlots } from './slots.ts';

describe('scan slots', () => {
  it('answers 503 with Retry-After when none is free, and frees a slot on any ending', async () => {
    const slots = createSlots(1);
    let finish: () => void = () => undefined;
    const first = slots.run(() => new Promise<void>((resolve) => (finish = resolve)));
    await expect(slots.run(() => Promise.resolve())).rejects.toMatchObject({
      status: 503,
      headers: { 'retry-after': '5' },
    });
    finish();
    await first;
    await expect(slots.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(slots.run(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
