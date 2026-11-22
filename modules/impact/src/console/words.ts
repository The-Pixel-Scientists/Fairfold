// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Figures, periods and choices in the words the screens use.

import { formatMoney } from '@pixel-scientists/domain/platform';

import { figureProblem } from '../contracts/index.ts';
import type {
  IndicatorAggregation,
  IndicatorDirection,
  IndicatorSummary,
  IndicatorUnit,
  ResultSource,
} from '../contracts/index.ts';

export const unitWords = {
  count: 'Count',
  people: 'People',
  percentage: 'Percentage',
  money: 'Money in pounds',
  hours: 'Hours',
  number: 'Other number',
} as const satisfies Record<IndicatorUnit, string>;

export const directionWords = {
  increase: 'A higher figure is better',
  decrease: 'A lower figure is better',
} as const satisfies Record<IndicatorDirection, string>;

export const aggregationWords = {
  sum: 'Add the results up',
  average: 'Average the results',
  latest: 'Use the latest result',
} as const satisfies Record<IndicatorAggregation, string>;

export const sourceWords = {
  manual: 'Entered by hand',
  monitoring_report: 'Monitoring report',
} as const satisfies Record<ResultSource, string>;

const numbers = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/** A stored figure as people read it: money in pounds, a percentage with its sign. */
export function formatFigure(unit: IndicatorUnit, value: number): string {
  switch (unit) {
    case 'money':
      return formatMoney({ amountMinor: value, currency: 'GBP' });
    case 'percentage':
      return `${numbers.format(value)}%`;
    case 'hours':
      return `${numbers.format(value)} ${value === 1 ? 'hour' : 'hours'}`;
    default:
      return numbers.format(value);
  }
}

/** A figure as it is typed into a box: money in pounds, without a sign or separators. */
export function figureText(unit: IndicatorUnit, value: number): string {
  return unit === 'money' ? String(value / 100) : String(value);
}

export type Figure = { value: number } | { problem: string };

/** What was typed in a box, as a stored figure, or the words about what is wrong with it. */
export function parseFigure(unit: IndicatorUnit, text: string): Figure {
  const clean = text.replace(/[,\s]/g, '');
  const pattern = unit === 'money' ? /^\d+(\.\d{1,2})?$/ : /^\d+(\.\d+)?$/;
  if (clean === '') return { problem: 'Enter a figure, such as 120.' };
  if (!pattern.test(clean)) {
    return {
      problem:
        unit === 'money'
          ? 'Enter an amount in pounds, with up to 2 decimal places, such as 2500.50.'
          : 'Enter a figure using digits only, such as 120.',
    };
  }
  const value = unit === 'money' ? Math.round(Number(clean) * 100) : Number(clean);
  const problem = figureProblem(unit, value);
  return problem === null ? { value } : { problem };
}

/** What a figure's box is called, with its unit where that helps. */
export function figureLabel(name: string, unit: IndicatorUnit | undefined): string {
  if (unit === 'money') return `${name} (£)`;
  if (unit === 'percentage') return `${name} (%)`;
  return name;
}

/**
 * How far the combined results are towards the target, as a whole percentage
 * from 0. Where lower is better, it counts from the baseline down to the
 * target. Null when there is no figure to compare, or no distance to cover.
 */
export function progressPercent(
  summary: IndicatorSummary,
  direction: IndicatorDirection,
): number | null {
  const { value, target, baseline } = summary;
  if (value === null || target === null) return null;
  if (direction === 'increase')
    return target === 0 ? null : Math.max(0, Math.round((value / target) * 100));
  if (baseline === null || baseline === target) return null;
  return Math.max(0, Math.round(((baseline - value) / (baseline - target)) * 100));
}

const days = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-04-01` as "1 April 2026". Anything else comes back as it was. */
export function formatDay(date: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(date)
    ? new Date(`${date.slice(0, 10)}T00:00:00Z`)
    : null;
  return parsed === null || Number.isNaN(parsed.getTime()) ? date : days.format(parsed);
}

export const formatPeriod = (start: string, end: string) =>
  `${formatDay(start)} to ${formatDay(end)}`;
