// SPDX-License-Identifier: AGPL-3.0-or-later

/** A whole-number percentage, such as `68%`. */
export function percent(part: number, whole: number): string {
  return `${String(Math.round((part / whole) * 100))}%`;
}

/** A count with thousands separators, such as `18,402`. */
export function count(value: number): string {
  return value.toLocaleString('en-GB');
}

/** The only way a count under 5 is shown anywhere in Insight. */
export const FEWER_THAN_5 = 'Fewer than 5';

/** A count of people, or the words that stand for one under 5. */
export function safeCount(value: number): string {
  return value < 5 ? FEWER_THAN_5 : count(value);
}
