// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';
import { useId } from 'react';

export interface FilterChipProps {
  /** What is filtered, such as "Theme". */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  /** True when the filter narrows the view. It is then bolder and outlined in ink, so colour is not the only sign. */
  active?: boolean;
}

/**
 * A filter as a chip: its name and its current choice in a pill. A real select
 * lies invisibly over the whole pill, so a click anywhere on it opens the
 * browser's own list, and the pill takes the focus ring.
 */
export function FilterChip({ label, value, options, onChange, active = false }: FilterChipProps) {
  const id = useId();
  const current = options.find((option) => option.value === value)?.label;
  return (
    <div
      className={cx(
        'relative inline-flex h-8 items-center gap-1.5 rounded-full border pr-2 pl-3 text-sm shadow-(--shadow-raised)',
        'transition-colors duration-(--motion-fast) ease-standard hover:border-ink',
        'has-[:focus-visible]:outline-(length:--focus-ring-width) has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
        active ? 'border-ink bg-accent-soft' : 'border-edge bg-surface',
      )}
    >
      <span aria-hidden="true" className="text-muted">
        {label}
      </span>
      <span aria-hidden="true" className={cx('text-ink', active ? 'font-semibold' : 'font-medium')}>
        {current}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
