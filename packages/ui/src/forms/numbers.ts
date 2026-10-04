// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turning what a person types into the answer the engine expects, and back.
// Text that does not read as a number or an amount is passed on as typed, so
// the engine says what is wrong and the person's words stay on screen.

import type { FormMoney } from './types.ts';

const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const MINOR_UNITS_PER_POUND = 100;

export const POUND = '£';

/** The text for a number answer, or for what was typed in its place. */
export function numberText(answer: unknown): string {
  if (typeof answer === 'number') return String(answer);
  return typeof answer === 'string' ? answer : '';
}

/** A number, or null for blank text, or the text itself when it is not a number. */
export function numberAnswer(text: string): number | string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return NUMBER.test(trimmed) ? Number(trimmed.replaceAll(',', '')) : text;
}

/** Pounds for an amount in pence: "25000", or "25000.50" when there are pence. */
export function amountText(answer: unknown): string {
  if (typeof answer === 'string') return answer;
  if (typeof answer !== 'object' || answer === null) return '';
  const { amountMinor } = answer as Partial<FormMoney>;
  if (typeof amountMinor !== 'number') return '';
  const pounds = amountMinor / MINOR_UNITS_PER_POUND;
  return amountMinor % MINOR_UNITS_PER_POUND === 0 ? String(pounds) : pounds.toFixed(2);
}

/** An amount in pence for text in pounds, with or without £ and commas; null for blank text; else the text. */
export function amountAnswer(text: string): FormMoney | string | null {
  const trimmed = text.trim().replace(POUND, '').trim();
  if (trimmed === '') return null;
  if (!AMOUNT.test(trimmed)) return text;
  const [pounds = '', pence = ''] = trimmed.replaceAll(',', '').split('.');
  const amountMinor = Number(pounds) * MINOR_UNITS_PER_POUND + Number(pence.padEnd(2, '0'));
  return Number.isSafeInteger(amountMinor) ? { amountMinor, currency: 'GBP' } : text;
}
