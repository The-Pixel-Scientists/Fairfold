// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

import { cx } from './cx.ts';

export interface CheckboxProps {
  id?: string;
  /** What ticking it means, such as "Late only" or, for a box in a table row, "Select Riverside Lunch Club". */
  label: string;
  /** Keeps the label for screen readers only, for a box with no room for words. */
  labelHidden?: boolean;
  checked: boolean;
  /** Some of a group ticked, such as some rows of a table. The box shows a dash and is read as mixed. */
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/**
 * One browser checkbox with its label, reached with Tab and ticked with
 * Space, in a 24px target. For several related choices use CheckboxGroup.
 */
export function Checkbox({
  id,
  label,
  labelHidden = false,
  checked,
  indeterminate = false,
  onCheckedChange,
  className,
}: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cx(
        'inline-flex min-h-target min-w-target items-center justify-center gap-2 text-body text-ink',
        className,
      )}
    >
      <input
        id={id}
        ref={input}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onCheckedChange(event.currentTarget.checked);
        }}
        className="size-5 shrink-0 accent-accent"
      />
      <span className={labelHidden ? 'sr-only' : undefined}>{label}</span>
    </label>
  );
}
