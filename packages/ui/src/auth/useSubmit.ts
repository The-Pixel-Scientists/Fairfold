// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import type { ErrorSummaryItem } from '../ErrorSummary.tsx';
import { asProblem } from './problems.ts';

const UNEXPECTED = 'Something went wrong. Try again.';

interface Problem {
  /** The form field it belongs to, or null for a problem with the whole form. */
  field: string | null;
  message: string;
}

/** `body.email` is the field `email`; a path that is not one of the form's fields belongs to the form. */
function fieldNamed(path: string, fields: readonly string[]): string | null {
  const name = path.startsWith('body.') ? path.slice('body.'.length) : path;
  return fields.includes(name) ? name : null;
}

function problemsOf(error: unknown, fields: readonly string[]): Problem[] {
  const problem = asProblem(error);
  if (problem === null) return [{ field: null, message: UNEXPECTED }];
  if (problem.errors.length === 0) return [{ field: null, message: problem.detail }];
  return problem.errors.map(({ field, message }) => ({
    field: fieldNamed(field, fields),
    message,
  }));
}

export interface UseSubmit {
  /** Give this to the form. It stops the browser's own submit, and ignores a second press while one is running. */
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  /** True while the action runs. Show it with `aria-disabled` on the button, so focus stays put. */
  pending: boolean;
  /** For the ErrorSummary, one per problem. A problem with the whole form links to the first field. */
  errors: ErrorSummaryItem[];
  /** The message to show beside a field, if it has one. */
  errorFor: (field: string) => string | undefined;
  /** Counts failed attempts. Use it as the ErrorSummary's `key`, so focus goes to it again. */
  attempt: number;
}

/**
 * Run a form's action, and turn what goes wrong into messages for the
 * ErrorSummary and the fields. The action gets the form's data and throws the
 * API's problem on failure (a `ProblemError`). Field names are the inputs'
 * `name` and `id`, first field first.
 */
export function useSubmit(
  fields: readonly string[],
  action: (data: FormData) => Promise<void>,
): UseSubmit {
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  async function run(form: HTMLFormElement) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await action(new FormData(form));
      setProblems([]);
    } catch (error) {
      setProblems(problemsOf(error, fields));
      setAttempt((count) => count + 1);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return {
    onSubmit(event) {
      event.preventDefault();
      void run(event.currentTarget);
    },
    pending,
    errors: problems.map(({ field, message }) => ({
      fieldId: field ?? fields[0] ?? '',
      message,
    })),
    errorFor: (field) => problems.find((problem) => problem.field === field)?.message,
    attempt,
  };
}
