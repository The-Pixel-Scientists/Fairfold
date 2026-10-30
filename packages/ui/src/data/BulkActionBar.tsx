// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import type { ReactNode } from 'react';

import { Button } from '../Button.tsx';

export interface BulkActionBarProps {
  /** How many rows are selected. */
  count: number;
  /** What a row is, in the singular and the plural, such as "submission" and "submissions". */
  noun: { one: string; other: string };
  /** Called when "Clear selection" is pressed. The bar then moves focus to its count, so it is not lost. */
  onClear: () => void;
  /** The actions, as buttons that say what they do. Disable them while nothing is selected. */
  children: ReactNode;
}

/**
 * The actions for the rows selected in a table, above it. It says how many
 * are selected, and a screen reader hears each change of that count.
 */
export function BulkActionBar({ count, noun, onClear, children }: BulkActionBarProps) {
  const status = useRef<HTMLParagraphElement>(null);
  return (
    <div
      role="group"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-divider bg-sunken/60 px-3 py-2"
    >
      <p ref={status} tabIndex={-1} aria-live="polite" className="text-body text-muted">
        {count === 0 ? (
          `Select ${noun.other} to act on several at once.`
        ) : (
          <span className="font-semibold text-ink">
            {count} {count === 1 ? noun.one : noun.other} selected
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {count > 0 && (
        <Button
          variant="quiet"
          className="sm:ml-auto"
          onClick={() => {
            onClear();
            status.current?.focus();
          }}
        >
          Clear selection
        </Button>
      )}
    </div>
  );
}
