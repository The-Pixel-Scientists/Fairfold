// SPDX-License-Identifier: AGPL-3.0-or-later

import { ErrorSummary, asProblem } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { StepUp } from '../../platform/team/useStepUp.tsx';

/** A section of the page: a heading that takes focus after a change, and what the section does. */
export function Section({
  id,
  title,
  headingRef,
  children,
}: {
  id: string;
  title: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-divider bg-surface p-gutter"
    >
      <h2
        id={id}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold tracking-tight text-ink"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Moves focus to a section's heading after a change. A step-up dialog that
 * has just closed gives focus back to the button that opened it a moment
 * after it leaves the page, and that button is often gone or about to be
 * replaced. So wait until the dialog is gone, then until that has happened.
 */
export function focusWhenSettled(heading: RefObject<HTMLElement | null>) {
  const settle = () => {
    if (document.querySelector('[role="dialog"]') !== null) {
      requestAnimationFrame(settle);
      return;
    }
    setTimeout(() => heading.current?.focus(), 0);
  };
  settle();
}

/** What a section says after a change, announced once. */
export function Result({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="min-h-6 text-body font-medium text-success">
      {children}
    </p>
  );
}

/**
 * Runs a button's action behind step-up. A refusal, such as the last-factor
 * rule, shows in the section's error summary in the server's words. Gives
 * what the action returned, or `null` when it did not run or failed.
 */
export function useAction(stepUp: StepUp, fieldId: string) {
  const [error, setError] = useState({ message: '', count: 0 });

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setError((current) => ({ ...current, message: '' }));
    try {
      return await stepUp.run(action);
    } catch (failure) {
      const message = asProblem(failure)?.detail ?? 'Something went wrong. Try again.';
      setError(({ count }) => ({ message, count: count + 1 }));
      return null;
    }
  }

  const summary = (
    <ErrorSummary
      key={error.count}
      errors={error.message === '' ? [] : [{ fieldId, message: error.message }]}
    />
  );
  return { run, summary };
}
