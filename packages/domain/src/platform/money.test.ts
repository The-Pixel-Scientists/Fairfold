// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formatMoney, moneySchema } from './money.ts';

describe('moneySchema', () => {
  it('takes a whole number of minor units with a currency', () => {
    expect(moneySchema.parse({ amountMinor: 2_500_000, currency: 'GBP' })).toEqual({
      amountMinor: 2_500_000,
      currency: 'GBP',
    });
  });

  it('refuses fractions, strings, unsafe integers, other currencies and extra keys', () => {
    for (const value of [
      { amountMinor: 10.5, currency: 'GBP' },
      { amountMinor: '1000', currency: 'GBP' },
      { amountMinor: 2 ** 53, currency: 'GBP' },
      { amountMinor: 1000, currency: 'USD' },
      { amountMinor: 1000, currency: 'GBP', amount: 10 },
    ]) {
      expect(moneySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('formatMoney', () => {
  it('writes pounds as the content style guide does', () => {
    expect(formatMoney({ amountMinor: 2_500_000, currency: 'GBP' })).toBe('£25,000');
    expect(formatMoney({ amountMinor: 15_000_000, currency: 'GBP' })).toBe('£150,000');
    expect(formatMoney({ amountMinor: 0, currency: 'GBP' })).toBe('£0');
  });

  it('shows pence only when there are some', () => {
    expect(formatMoney({ amountMinor: 2_500_050, currency: 'GBP' })).toBe('£25,000.50');
    expect(formatMoney({ amountMinor: 1, currency: 'GBP' })).toBe('£0.01');
  });
});
