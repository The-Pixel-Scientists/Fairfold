// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BODIES_AT_ONCE,
  uploadBuckets,
  uploadCharge,
  uploadLimitMessage,
  uploadLimits,
} from './limits.ts';
import { fileWithheldMessages } from './messages.ts';

describe('upload limits', () => {
  it("are ADR 0030's four buckets", () => {
    expect(Object.keys(uploadLimits)).toEqual([...uploadBuckets]);
    expect(uploadLimits).toEqual({
      upload_files_membership: {
        counts: 'files',
        key: 'membership',
        windowSeconds: 3600,
        max: 100,
      },
      upload_bytes_membership: {
        counts: 'bytes',
        key: 'membership',
        windowSeconds: 43_200,
        max: 262_144_000,
      },
      upload_files_address: { counts: 'files', key: 'address', windowSeconds: 3600, max: 300 },
      upload_bytes_address: {
        counts: 'bytes',
        key: 'address',
        windowSeconds: 43_200,
        max: 1_073_741_824,
      },
    });
    expect(MAX_UPLOAD_BODIES_AT_ONCE).toBe(16);
  });

  it('keep every window within the 12 hours ADR 0028 allows', () => {
    for (const limit of Object.values(uploadLimits)) {
      expect(limit.windowSeconds).toBeLessThanOrEqual(12 * 3600);
    }
  });

  it('charge a file bucket 1 and a byte bucket the declared length', () => {
    expect(uploadCharge('upload_files_membership', 48_213)).toBe(1);
    expect(uploadCharge('upload_files_address', 48_213)).toBe(1);
    expect(uploadCharge('upload_bytes_membership', 48_213)).toBe(48_213);
    expect(uploadCharge('upload_bytes_address', 48_213)).toBe(48_213);
  });
});

describe('uploadLimitMessage', () => {
  it('says when to try again, rounded up', () => {
    const text = (wait: string) =>
      `You have uploaded as many files as you can for now. Try again in ${wait}.`;
    expect(uploadLimitMessage(0)).toBe(text('1 minute'));
    expect(uploadLimitMessage(61)).toBe(text('2 minutes'));
    expect(uploadLimitMessage(3540)).toBe(text('59 minutes'));
    expect(uploadLimitMessage(3600)).toBe(text('1 hour'));
    expect(uploadLimitMessage(3601)).toBe(text('2 hours'));
    expect(uploadLimitMessage(43_200)).toBe(text('12 hours'));
  });
});

describe('withheld file messages', () => {
  it('are sentences that never name the file', () => {
    for (const text of Object.values(fileWithheldMessages)) {
      expect(text).toMatch(/^This file is held back because a later virus check flagged it/);
      expect(text).toMatch(/^[A-Z][^.]*\.( [A-Z][^.]*[.])+$/);
    }
  });
});
