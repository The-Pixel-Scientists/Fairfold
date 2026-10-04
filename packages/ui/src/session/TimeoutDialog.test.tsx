// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { spokenDuration } from './TimeoutDialog.tsx';

describe('spokenDuration', () => {
  it('rounds up to 30 seconds, so a screen reader hears the time only twice a minute', () => {
    expect(spokenDuration(120_000)).toBe('2 minutes');
    expect(spokenDuration(119_000)).toBe('2 minutes');
    expect(spokenDuration(91_000)).toBe('2 minutes');
    expect(spokenDuration(90_000)).toBe('1 minute 30 seconds');
    expect(spokenDuration(61_000)).toBe('1 minute 30 seconds');
    expect(spokenDuration(60_000)).toBe('1 minute');
    expect(spokenDuration(31_000)).toBe('1 minute');
    expect(spokenDuration(30_000)).toBe('30 seconds');
  });

  it('never says less than 30 seconds, since it is not announced again before the end', () => {
    expect(spokenDuration(5_000)).toBe('30 seconds');
    expect(spokenDuration(0)).toBe('30 seconds');
    expect(spokenDuration(-1_000)).toBe('30 seconds');
  });
});
