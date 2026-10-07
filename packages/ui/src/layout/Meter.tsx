// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';

import { cx } from '../cx.ts';

export type MeterTone = 'accent' | 'success' | 'warning' | 'danger';

export interface MeterProps {
  /** What is measured, such as "Average score". It is shown, and names the meter. */
  label: string;
  value: number;
  /** Defaults to 0. */
  min?: number;
  max: number;
  /** The value in words, such as "3.8 of 5". It is shown beside the label and read aloud. */
  valueText: string;
  /** Colour for the fill. The text says what the value means; the tone only reinforces it. */
  tone?: MeterTone;
}

const fills: Record<MeterTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** A bar for a value within a known range, such as a score or the budget committed. */
export function Meter({ label, value, min = 0, max, valueText, tone = 'accent' }: MeterProps) {
  const labelId = useId();
  const now = Math.min(Math.max(value, min), max);
  const fraction = max > min ? (now - min) / (max - min) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span id={labelId} className="font-medium text-muted">
          {label}
        </span>
        <span className="text-ink tabular-nums">{valueText}</span>
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuenow={now}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText}
        className="h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-divider ring-inset"
      >
        <div
          className={cx('h-full rounded-full', fills[tone])}
          style={{ width: `${String(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
