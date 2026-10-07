// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

export interface CheckboxProps {
  id?: string;
  /** What ticking it means. */
  label: string;
  /** Keeps the label for screen readers only, for a box in a table row. */
  labelHidden?: boolean;
  checked: boolean;
  /** A partly ticked group, such as some rows of a table selected. */
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** A single browser checkbox with a label and a 24px target, for filters and row selection. */
export function Checkbox({
  id,
  label,
  labelHidden = false,
  checked,
  indeterminate = false,
  onCheckedChange,
}: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="inline-flex min-h-target min-w-target items-center justify-center gap-2 text-body text-ink">
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
