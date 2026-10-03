// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useRef } from 'react';
import type { MouseEvent } from 'react';

import { cx } from './cx.ts';
import { focusElement } from './focus.ts';

export interface ErrorSummaryItem {
  /** The id of the field with the problem; the message links to it. */
  fieldId: string;
  /** What went wrong and how to fix it. Use the same words as the message beside the field. */
  message: string;
}

export interface ErrorSummaryProps {
  errors: readonly ErrorSummaryItem[];
  /** Defaults to "There is a problem". */
  title?: string;
  className?: string;
}

/**
 * Lists everything wrong with a form, at the top of the form. When errors
 * first appear it takes focus, so a screen reader reads it straight away.
 * Each message links to its field, and activating it moves focus there.
 *
 * To move focus here again after another failed submit, give the component a
 * new `key`, for example the number of submit attempts.
 */
export function ErrorSummary({
  errors,
  title = 'There is a problem',
  className,
}: ErrorSummaryProps) {
  const titleId = useId();
  const container = useRef<HTMLDivElement>(null);
  const hasErrors = errors.length > 0;

  useEffect(() => {
    if (hasErrors && container.current) focusElement(container.current);
  }, [hasErrors]);

  if (!hasErrors) return null;

  function goToField(event: MouseEvent<HTMLAnchorElement>, fieldId: string) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    event.preventDefault();
    focusElement(field);
  }

  return (
    <div
      ref={container}
      role="alert"
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cx('rounded-md border-2 border-danger bg-danger-soft p-4', className)}
    >
      <h2 id={titleId} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        {errors.map((error) => (
          <li key={`${error.fieldId}:${error.message}`} className="text-body text-danger">
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                goToField(event, error.fieldId);
              }}
              className="block min-h-target font-medium text-danger underline hover:text-danger-hover"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
