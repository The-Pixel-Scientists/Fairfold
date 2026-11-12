// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { changedSince, listed } from './snapshot.ts';
import type { CurrentRecord } from './snapshot.ts';

const record: CurrentRecord = {
  name: 'Riverside Youth Trust',
  legalForm: 'registered_charity',
  registeredAddress: {
    line1: '1 High Street',
    line2: null,
    town: 'Leeds',
    postcode: 'LS1 1AA',
    countryCode: 'GB',
  },
  website: 'https://riverside.example',
  identifiers: [
    { scheme: 'GB-CHC', identifier: '1234567', verifiedAt: '2026-09-01T10:00:00.000Z' },
    { scheme: 'GB-COH', identifier: '01234567', verifiedAt: null },
  ],
};

describe('what changed since the application was submitted', () => {
  it('finds nothing when the record is as it was, whatever order the identifiers come in', () => {
    expect(
      changedSince(record, { ...record, identifiers: [...record.identifiers].reverse() }),
    ).toEqual([]);
  });

  it('names each part that differs', () => {
    expect(
      changedSince(record, {
        ...record,
        name: 'Riverside Youth Trust CIO',
        website: null,
        registeredAddress: { ...record.registeredAddress, town: 'York' },
        identifiers: [],
      }),
    ).toEqual(['name', 'registered address', 'website', 'identifiers']);
  });

  it('puts a list in a sentence', () => {
    expect(listed(['name'])).toBe('name');
    expect(listed(['name', 'website'])).toBe('name and website');
    expect(listed(['name', 'website', 'identifiers'])).toBe('name, website and identifiers');
  });
});
