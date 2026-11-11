// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The figures a result, baseline or target holds. A request's schema checks
// what holds for every unit; the unit lives on the indicator, which only the
// server can read, so the server calls figureProblem() with it and answers
// `impactRefusals.valueForUnit` or the message returned.

import { z } from 'zod';

import type { IndicatorUnit } from './frameworks.ts';
import { impactMessages, says, type ImpactMessage } from './messages.ts';

/** High enough for a national total in pence, and exact in a double. */
export const MAX_FIGURE = 1_000_000_000_000;

/** Whether `value` has at most 2 decimal places, without trusting binary fractions. */
function twoPlaces(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

/** Never negative, never more than 2 decimal places, whatever the unit. */
export const figureSchema = z
  .number()
  .min(0)
  .max(MAX_FIGURE)
  .refine(twoPlaces, says(impactMessages.decimalPlaces));

/** What is wrong with a figure for an indicator of this unit, or null when it fits. */
export function figureProblem(unit: IndicatorUnit, value: number): ImpactMessage | null {
  if (!figureSchema.safeParse(value).success) return impactMessages.decimalPlaces;
  switch (unit) {
    case 'count':
    case 'people':
    case 'money':
      return Number.isInteger(value) ? null : impactMessages.wholeNumber;
    case 'percentage':
      return value <= 100 ? null : impactMessages.percentage;
    case 'hours':
    case 'number':
      return null;
  }
}
