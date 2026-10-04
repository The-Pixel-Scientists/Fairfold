// SPDX-License-Identifier: AGPL-3.0-or-later

/** What went wrong with one field, in words to show. */
export interface FieldProblemLike {
  readonly field: string;
  readonly message: string;
}

/**
 * What a failed API call looks like to these components. The domain
 * package's `ProblemError` fits it, so the library does not import it.
 */
export interface ProblemLike {
  /** The HTTP status; 0 when the API could not be reached. */
  readonly status: number;
  /** Words for the whole request. */
  readonly detail: string;
  readonly errors: readonly FieldProblemLike[];
}

function isFieldProblem(value: unknown): value is FieldProblemLike {
  if (typeof value !== 'object' || value === null) return false;
  const { field, message } = value as Record<string, unknown>;
  return typeof field === 'string' && typeof message === 'string';
}

/** The error as a problem, or null for anything else, such as a mistake in our own code. */
export function asProblem(error: unknown): ProblemLike | null {
  if (typeof error !== 'object' || error === null) return null;
  const { status, detail, errors } = error as Record<string, unknown>;
  if (typeof status !== 'number' || typeof detail !== 'string' || !Array.isArray(errors)) {
    return null;
  }
  return { status, detail, errors: errors.filter(isFieldProblem) };
}

/** The text of a form field, or an empty string. Reads what was typed, never anything else. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}
