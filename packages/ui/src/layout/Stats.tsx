// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

export interface StatItem {
  /** What is counted, such as "Applications received". */
  label: string;
  value: ReactNode;
  /** Context for the number, such as "12 since Monday". */
  detail?: ReactNode;
}

export interface StatsProps {
  /** Names the group for screen readers, such as "Round summary". It is not shown. */
  label: string;
  items: readonly StatItem[];
}

/** Key numbers as tiles that wrap to fit, each with a large value and an optional detail. */
export function Stats({ label, items }: StatsProps) {
  return (
    <div role="group" aria-label={label}>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-divider bg-surface p-4"
          >
            <dt className="text-sm font-medium text-muted">{item.label}</dt>
            <dd className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
              {item.value}
            </dd>
            {item.detail !== undefined && item.detail !== null && (
              <dd className="text-sm text-muted">{item.detail}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
