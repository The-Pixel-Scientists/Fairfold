// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MonitoringCell } from '../../contracts/index.ts';
import { cellText } from './suppressed.ts';

export interface ChartRow {
  label: string;
  total: MonitoringCell;
}

/**
 * Totals of each answer as bars, from the figures shown only. A hidden total
 * has a label and no bar. The table beside it holds the same data, so the
 * chart is hidden from assistive technology.
 */
export function MonitoringChart({
  caption,
  rows,
  threshold,
}: {
  caption: string;
  rows: readonly ChartRow[];
  threshold: number;
}) {
  const largest = Math.max(1, ...rows.map(({ total }) => (total.suppressed ? 0 : total.count)));
  return (
    <figure aria-hidden="true" className="flex flex-col gap-2">
      <figcaption className="text-body font-medium text-ink">{caption}</figcaption>
      <ul className="flex flex-col gap-2">
        {rows.map(({ label, total }) => (
          <li
            key={label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)_6.5rem]"
          >
            <span className="text-body text-ink sm:truncate">{label}</span>
            <span className="text-end text-body text-ink tabular-nums sm:order-3">
              {cellText(total, threshold)}
            </span>
            <span className="col-span-2 sm:col-span-1">
              {total.suppressed ? null : (
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full">
                  <rect width="100" height="10" className="fill-sunken" />
                  <rect width={(total.count / largest) * 100} height="10" className="fill-accent" />
                </svg>
              )}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
