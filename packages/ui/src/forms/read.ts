// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the parts of an answer are read for display. A value that does not fit
// its field is no answer, so a wrong answer is never shown as a right one.

import type { FormMoney } from './types.ts';

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 20 });

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isMoney(value: unknown): value is FormMoney {
  const { amountMinor, currency } = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Partial<FormMoney>;
  return typeof amountMinor === 'number' && currency === 'GBP';
}

/** A number as people read it, or null when the value is not a number. */
export function readNumber(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : null;
}
