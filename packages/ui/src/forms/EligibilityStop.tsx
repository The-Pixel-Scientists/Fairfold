// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';

import { Button } from '../Button.tsx';
import { focusElement } from '../focus.ts';

export interface EligibilityStopProps {
  /** Why the answer stops the applicant: the `explanation` that `checkEligibility()` returns. */
  explanation: string;
  /** The question whose answer stopped them: the `fieldId` that `checkEligibility()` returns. */
  fieldId: string;
  /** The heading level, so the notice fits the page's outline. Defaults to h2. */
  headingLevel?: 'h2' | 'h3';
}

/**
 * Tells an applicant that an answer means they cannot go on, why, and what
 * they can do: change the answer if it was a mistake, or stop knowing there
 * is nothing else to do. It is announced when it appears.
 */
export function EligibilityStop({
  explanation,
  fieldId,
  headingLevel: Heading = 'h2',
}: EligibilityStopProps) {
  const titleId = useId();

  return (
    <div
      role="alert"
      aria-labelledby={titleId}
      className="flex max-w-prose flex-col items-start gap-3 rounded-md border-2 border-warning bg-warning-soft p-4"
    >
      <Heading id={titleId} className="text-lg font-semibold text-ink">
        You cannot apply with this answer
      </Heading>
      <p className="text-body text-ink">{explanation}</p>
      <p className="text-body text-ink">
        If your answer is wrong, change it and carry on. If it is right, there is nothing more for
        you to do here.
      </p>
      <Button
        onClick={() => {
          const question = document.getElementById(fieldId);
          if (question !== null) focusElement(question);
        }}
      >
        Change your answer
      </Button>
    </div>
  );
}
