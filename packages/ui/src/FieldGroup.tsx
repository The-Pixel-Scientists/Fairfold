// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from './cx.ts';

export interface FieldGroupProps {
  /** The question, which names the group. */
  legend: ReactNode;
  /** Help that applies before the person answers. */
  hint?: ReactNode;
  /** What went wrong and how to fix it. Leave it out when the answer is valid. */
  error?: ReactNode;
  /** The hint and error take ids that start with this one. Generated when left out. */
  id?: string;
  className?: string;
  /** The controls. */
  children: ReactNode;
}

function isPresent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/**
 * Several controls that answer one question, in a `fieldset` named by its
 * `legend`. The hint and error describe the group, and the error has a
 * border as well as colour.
 */
export function FieldGroup({ legend, hint, error, id, className, children }: FieldGroupProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const hasHint = isPresent(hint);
  const hasError = isPresent(error);
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset
      aria-describedby={describedBy === '' ? undefined : describedBy}
      className={cx(
        'flex min-w-0 flex-col gap-field-gap',
        hasError && 'border-l-4 border-danger pl-3',
        className,
      )}
    >
      <legend className="text-body font-medium text-ink">{legend}</legend>
      {hasHint && (
        <p id={hintId} className="text-body text-muted">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-body font-medium text-danger">
          <span className="sr-only">Error:</span> {error}
        </p>
      )}
      {children}
    </fieldset>
  );
}
