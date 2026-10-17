// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Problems with a form's fields, in the form useSubmit shows them: each one
// named by the id of the control it belongs to.

import { ProblemError } from '@pixel-scientists/domain/api';
import { fieldForIssue, messageForIssue, messages } from '@pixel-scientists/domain/platform';
import type { FieldProblem, IssueLike } from '@pixel-scientists/domain/platform';

/** Stops a save with these problems, as call() does for input it refuses. Does nothing when there are none. */
export function refuse(problems: readonly FieldProblem[]): void {
  if (problems.length > 0) throw new ProblemError(400, messages.fixFields, { errors: problems });
}

/** What a contract's schema gives back from safeParse(), which is all `refuseUnless` needs of it. */
interface Schema {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: readonly IssueLike[] } };
}

const isWithin = (field: string, parent: string) =>
  field === parent || field.startsWith(`${parent}.`);

/**
 * Stops a save with everything wrong in `body`: the problems found already,
 * in words about the box they were typed in, and then what the contract's
 * own checks find in the rest, which call() would find too. Problems are in
 * the order `rank` gives their fields, which is the order of the form. The
 * contract's checks are left out for the fields in `covered`, which are those
 * of the problems found unless you say others.
 */
export function refuseUnless(
  schema: Schema,
  body: unknown,
  found: readonly FieldProblem[],
  rank: (field: string) => number,
  covered: readonly string[] = found.map(({ field }) => field),
): void {
  const problems = [...found];
  for (const issue of schema.safeParse(body).error?.issues ?? []) {
    const field = fieldForIssue('body', issue);
    if (!covered.some((parent) => isWithin(field, parent))) {
      problems.push({ field, message: messageForIssue(issue) });
    }
  }
  refuse(problems.sort((a, b) => rank(a.field) - rank(b.field)));
}

/** The field a problem names, less `body.` and anything inside it: `body.budget.amountMinor` is `budget`. */
export function topField(field: string): string {
  return field.replace(/^body\./, '').split('.')[0] ?? field;
}

/**
 * The action, with the field of each problem it throws renamed by `rename`.
 * The API names a field by its path in the request, and the page by the id
 * of its control.
 */
export function naming(rename: (field: string) => string, action: () => Promise<void>) {
  return async () => {
    try {
      await action();
    } catch (error) {
      if (!(error instanceof ProblemError) || error.errors.length === 0) throw error;
      throw new ProblemError(error.status, error.detail, {
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
        errors: error.errors.map(({ field, message }) => ({ field: rename(field), message })),
      });
    }
  };
}
