// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checks a form makes before it asks the API, in words about the box
// each was typed in. The contract's own checks run when the request is made.

import { ProblemError } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { IndicatorUnit } from '../contracts/index.ts';
import { parseFigure } from './words.ts';

/** Stops a save with these problems, as call() does for input it refuses. Does nothing when there are none. */
export function refuse(problems: readonly FieldProblem[]): void {
  if (problems.length > 0) throw new ProblemError(400, messages.fixFields, { errors: problems });
}

/** A figure typed in a box, as a stored figure; a problem is added to `problems` and 0 is returned. */
export function figureIn(
  field: string,
  unit: IndicatorUnit,
  text: string,
  problems: FieldProblem[],
): number {
  const figure = parseFigure(unit, text);
  if ('problem' in figure) {
    problems.push({ field, message: figure.problem });
    return 0;
  }
  return figure.value;
}

/** Problems with a period's two dates, which the date boxes give as `2026-04-01` or empty. */
export function periodProblems(start: string, end: string): FieldProblem[] {
  return [
    ...(start === ''
      ? [{ field: 'periodStart', message: 'Enter the date the period starts.' }]
      : []),
    ...(end === '' ? [{ field: 'periodEnd', message: 'Enter the date the period ends.' }] : []),
  ];
}
