// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

import { outcomes } from './decisions-data.ts';
import type { Outcome } from './decisions-data.ts';

const chosen: Record<Outcome, string> = {
  Accept: 'bg-success-soft font-semibold text-success ring-1 ring-success/30',
  Waitlist: 'bg-warning-soft font-semibold text-warning ring-1 ring-warning/30',
  Decline: 'bg-danger-soft font-semibold text-danger ring-1 ring-danger/30',
};

export interface OutcomeChoiceProps {
  /** Names the row, for the group's label and its radio buttons. */
  name: string;
  /** What the decision is about, such as the project's name. */
  subject: string;
  value: Outcome;
  onChange: (outcome: Outcome) => void;
}

/**
 * One decision for one application, as three radio buttons set in a row. They
 * are the browser's own, so Tab moves into the row and the arrow keys move
 * along it. The chosen one has a fill, a ring and heavier text, not colour alone.
 */
export function OutcomeChoice({ name, subject, value, onChange }: OutcomeChoiceProps) {
  return (
    <fieldset className="inline-flex gap-0.5 rounded-md border border-divider bg-sunken/50 p-0.5">
      <legend className="sr-only">Decision for {subject}</legend>
      {outcomes.map((outcome) => (
        <label
          key={outcome}
          className={cx(
            'flex min-h-6 cursor-pointer items-center rounded-sm px-2.5 py-0.5 text-sm',
            'transition-colors duration-(--motion-fast) ease-standard',
            'has-focus-visible:outline-3 has-focus-visible:outline-focus has-focus-visible:outline-offset-1',
            outcome === value ? chosen[outcome] : 'text-muted hover:bg-sunken hover:text-ink',
          )}
        >
          <input
            type="radio"
            name={name}
            value={outcome}
            checked={outcome === value}
            onChange={() => {
              onChange(outcome);
            }}
            className="sr-only scroll-mb-16"
          />
          {outcome}
        </label>
      ))}
    </fieldset>
  );
}
