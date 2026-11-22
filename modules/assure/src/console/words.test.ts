// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { matchOutcomes, matchReasonCodes, registryIds } from '../contracts/index.ts';
import {
  age,
  formatDay,
  isStale,
  outcomeWords,
  percent,
  reasonWords,
  registryWords,
} from './words.ts';

describe('words', () => {
  it('has words for every register, outcome and reason code', () => {
    expect(Object.keys(registryWords).sort()).toEqual([...registryIds].sort());
    expect(Object.keys(outcomeWords).sort()).toEqual([...matchOutcomes].sort());
    expect(Object.keys(reasonWords).sort()).toEqual([...matchReasonCodes].sort());
  });

  it('never calls a match sanctioned, blocked or failed', () => {
    const all = [...Object.values(outcomeWords), ...Object.values(reasonWords)].join(' ');
    expect(all).not.toMatch(/sanctioned|blocked|failed|rejected/i);
  });

  it('writes days, partial dates and similarity plainly', () => {
    expect(formatDay('2026-12-03')).toBe('3 December 2026');
    expect(formatDay('1970-05')).toBe('May 1970');
    expect(formatDay('1970')).toBe('1970');
    expect(percent(0.874)).toBe('87%');
  });

  it('calls a lookup out of date after 30 days', () => {
    const now = Date.parse('2026-12-31T12:00:00Z');
    expect(isStale('2026-12-01T12:00:00Z', now)).toBe(false);
    expect(isStale('2026-11-30T11:00:00Z', now)).toBe(true);
    expect(age('2026-12-31T08:00:00Z', now)).toBe('Today');
    expect(age('2026-12-29T08:00:00Z', now)).toBe('2 days');
  });
});
