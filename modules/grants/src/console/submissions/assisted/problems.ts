// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FieldProblem } from '@pixel-scientists/domain/platform';
import { asProblem } from '@pixel-scientists/ui';

import { UNEXPECTED } from '../../assessment/problems.ts';

/** Problems with answers to show beside their questions. The summary takes focus again each time `attempt` changes. */
export interface Problems {
  list: FieldProblem[];
  attempt: number;
}

const ANSWER = /^body\.answers\./;

/** Why a call failed, in the server's words, with the questions it names by their field ids. */
export function problemsOf(error: unknown): { detail: string; list: FieldProblem[] } {
  const problem = asProblem(error);
  if (problem === null) return { detail: UNEXPECTED, list: [] };
  return {
    detail: problem.detail,
    list: problem.errors
      .filter(({ field }) => ANSWER.test(field))
      .map(({ field, message }) => ({ field: field.replace(ANSWER, ''), message })),
  };
}
