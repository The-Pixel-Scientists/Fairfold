// SPDX-License-Identifier: AGPL-3.0-or-later

import { asProblem } from '@pixel-scientists/ui';

export const UNEXPECTED = 'Something went wrong. Try again.';

/** Why a call failed, in the server's words: what went wrong, then each thing it names. */
export function problemLines(error: unknown): string[] {
  const problem = asProblem(error);
  if (problem === null) return [UNEXPECTED];
  return [...new Set([problem.detail, ...problem.errors.map(({ message }) => message)])];
}
