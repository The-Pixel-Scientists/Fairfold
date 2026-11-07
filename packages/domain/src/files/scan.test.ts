// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  canChangeScanState,
  needsRescan,
  scanStateChanges,
  SIGNATURE_VERSION_TTL_SECONDS,
  signatureVersionSchema,
} from './scan.ts';
import { scanStates } from './view.ts';

describe('needsRescan', () => {
  it('rescans under newer signatures, or with no version recorded', () => {
    expect(needsRescan(27_430, 27_431)).toBe(true);
    expect(needsRescan(null, 27_431)).toBe(true);
    expect(needsRescan(27_431, 27_431)).toBe(false);
    expect(needsRescan(27_432, 27_431)).toBe(false);
    expect(SIGNATURE_VERSION_TTL_SECONDS).toBe(60);
  });

  it('takes a version that is a positive whole number only', () => {
    expect(signatureVersionSchema.parse(27_431)).toBe(27_431);
    for (const bad of [0, -1, 1.5, '27431', null]) {
      expect(signatureVersionSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe('scan state changes', () => {
  it('list every state', () => {
    expect(Object.keys(scanStateChanges).sort()).toEqual([...scanStates].sort());
  });

  it('allow exactly the changes the database allows', () => {
    const allowed = scanStates.flatMap((from) =>
      scanStates.filter((to) => canChangeScanState(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'pending>clean',
        'pending>infected',
        'pending>error',
        'clean>withheld',
        'withheld>clean',
        'withheld>infected',
      ].sort(),
    );
  });

  it('never return a file to pending, withhold it at upload, nor change a final one', () => {
    for (const from of scanStates) expect(canChangeScanState(from, 'pending')).toBe(false);
    expect(canChangeScanState('pending', 'withheld')).toBe(false);
    for (const to of scanStates) {
      expect(canChangeScanState('infected', to)).toBe(false);
      expect(canChangeScanState('error', to)).toBe(false);
    }
  });
});
