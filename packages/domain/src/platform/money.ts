// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Money in every contract, table and export (ADR 0016): a whole number of the
// currency's minor unit with its ISO 4217 code, never a decimal or a float.

import { z } from 'zod';

import { messages } from './messages.ts';

export const currencies = ['GBP'] as const;

export type Currency = (typeof currencies)[number];

/** Digits after the decimal point in each currency (its ISO 4217 minor unit). */
const minorDigits: Record<Currency, number> = { GBP: 2 };

export const moneySchema = z.strictObject({
  /** In the currency's minor unit: pence for GBP. */
  amountMinor: z.int(),
  currency: z.enum(currencies, { error: messages.currency }),
});

export type Money = z.infer<typeof moneySchema>;

/** As the content style guide writes it: "£25,000", with pence only when there are some. */
export function formatMoney(money: Money): string {
  const digits = minorDigits[money.currency];
  const scale = 10 ** digits;
  const fractionDigits = money.amountMinor % scale === 0 ? 0 : digits;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(money.amountMinor / scale);
}
