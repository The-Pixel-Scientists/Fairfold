// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a refused request means to a page. The two problems this module adds
// reach the browser as a plain 409 and a plain 400, so they are told apart by
// their status: a key problem is typed, and a refused answer lists its fields.

import { idempotencyProblems, ProblemError } from '@pixel-scientists/domain/api';

import { publicFormProblems } from '../contracts/index.ts';

export interface FieldProblem {
  field: string;
  message: string;
}

export type SubmitFailure = 'form_changed' | 'proof_invalid' | 'other';

export function failureOf(error: ProblemError): SubmitFailure {
  if (error.status === 409 && error.type === 'about:blank') return 'form_changed';
  if (error.status === 400 && error.errors.length === 0) return 'proof_invalid';
  return 'other';
}

/** The words for a refusal: the catalogue's own for the two this module adds. */
export function wordsFor(error: unknown): string {
  if (!(error instanceof ProblemError)) {
    return 'Something went wrong. Check your connection and try again.';
  }
  switch (failureOf(error)) {
    case 'form_changed':
      return publicFormProblems.formChanged.detail;
    case 'proof_invalid':
      return publicFormProblems.proofInvalid.detail;
    case 'other':
      return error.message;
  }
}

/** The answers the server refused, by the id of the question: `body.answers.f_name` is `f_name`. */
export function fieldProblemsOf(error: unknown): FieldProblem[] {
  if (!(error instanceof ProblemError)) return [];
  return error.errors
    .map(({ field, message }) => ({
      field: field.replace(/^(?:body\.)?(?:answers\.)?/, ''),
      message,
    }))
    .filter(({ field }) => /^[A-Za-z0-9_]/.test(field));
}

/**
 * The key to send again when a submission may not have arrived or is still
 * being handled, so a retry cannot send it twice. Otherwise the next try is a
 * new submission, with a key of its own.
 */
export function retryKeyOf(error: unknown): string | undefined {
  if (!(error instanceof ProblemError) || error.idempotencyKey === null) return undefined;
  const unsure =
    error.status === 0 || error.status >= 500 || error.type === idempotencyProblems.inProgress.type;
  return unsure ? error.idempotencyKey : undefined;
}
