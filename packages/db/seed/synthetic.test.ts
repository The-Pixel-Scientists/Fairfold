// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The invented values in synthetic.ts: identifiers inside each register's
// unissued range, which pass the scheme's own format check (S03-01),
// Ofcom's drama numbers, .example addresses and fictional postcodes.
// packages/db cannot depend on the party module, which depends on it, so
// its contracts are loaded by path here rather than copied.

import { beforeAll, describe, expect, it } from 'vitest';

import {
  dramaPhone,
  fictionalPostcode,
  inventedIdentifier,
  inventedRanges,
  isDramaPhone,
  isExampleEmail,
  isFictionalPostcode,
  isInventedIdentifier,
  type InventedScheme,
} from './synthetic.ts';

let party: { identifierInputSchema: { safeParse(value: unknown): unknown } };
beforeAll(async () => {
  const contracts = new URL('../../../modules/party/src/contracts/index.ts', import.meta.url).href;
  party = (await import(contracts)) as typeof party;
});

describe('synthetic values', () => {
  const schemes = Object.keys(inventedRanges) as InventedScheme[];

  it("invent identifiers inside each register's unissued range only", () => {
    for (const scheme of schemes) {
      const { first, last } = inventedRanges[scheme];
      expect(isInventedIdentifier(scheme, inventedIdentifier(scheme, 0))).toBe(true);
      expect(isInventedIdentifier(scheme, inventedIdentifier(scheme, last - first))).toBe(true);
      expect(() => inventedIdentifier(scheme, last - first + 1)).toThrow('has no number');
    }
    expect(inventedIdentifier('GB-CHC', 0)).toBe('1900000');
    expect(inventedIdentifier('GB-SC', 5)).toBe('SC090005');
    expect(inventedIdentifier('GB-NIC', 0)).toBe('190000');
    expect(inventedIdentifier('GB-COH', 1)).toBe('90000001');
    expect(inventedIdentifier('GB-MPR', 0)).toBe('RS090000');
    for (const [scheme, real] of [
      ['GB-CHC', '1089464'],
      ['GB-SC', 'SC012345'],
      ['GB-NIC', '100002'],
      ['GB-COH', '01234567'],
      ['GB-MPR', 'RS001234'],
    ] as const) {
      expect(isInventedIdentifier(scheme, real)).toBe(false);
    }
    // In range, but not as the register writes it.
    for (const [scheme, malformed] of [
      ['GB-SC', 'RS090005'],
      ['GB-SC', 'sc090005'],
      ['GB-SC', 'SC90005'],
      ['GB-SC', 'SC0090005'],
      ['GB-CHC', ' 1900000'],
      ['GB-CHC', '1.900000'],
      ['GB-NIC', '19e+05'],
      ['GB-COH', '+90000001'],
    ] as const) {
      expect(isInventedIdentifier(scheme, malformed), malformed).toBe(false);
    }
  });

  it("pass each scheme's own format check", () => {
    for (const scheme of schemes) {
      for (const n of [0, 1, 37, 9_999]) {
        const input = { scheme, identifier: inventedIdentifier(scheme, n) };
        expect(party.identifierInputSchema.safeParse(input)).toMatchObject({
          success: true,
          data: input,
        });
      }
    }
  });

  it("use Ofcom's drama numbers, .example addresses and fictional postcodes", () => {
    for (let n = 0; n < 4_000; n += 1) expect(isDramaPhone(dramaPhone(n))).toBe(true);
    expect([dramaPhone(0), dramaPhone(1), dramaPhone(1_999)]).toEqual([
      '07700 900000',
      '01632 960000',
      '01632 960999',
    ]);
    for (const phone of ['07700 901000', '01632 970000', '07700 90000', '020 7946 0000']) {
      expect(isDramaPhone(phone)).toBe(false);
    }
    for (let n = 0; n < 4_000; n += 1) expect(isFictionalPostcode(fictionalPostcode(n))).toBe(true);
    for (const postcode of ['SW1A 1AA', 'NF0 1AA', 'NF1 1AC', 'NF11 1AA']) {
      expect(isFictionalPostcode(postcode)).toBe(false);
    }
    expect(isExampleEmail('ada.morgan@applicants.westmere.example')).toBe(true);
    for (const email of ['ada@example.com', 'ada@westmere.example.org', 'Ada@x.example']) {
      expect(isExampleEmail(email)).toBe(false);
    }
  });
});
