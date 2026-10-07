// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export interface SummaryItem {
  /** What the value is, such as "Amount requested". */
  term: ReactNode;
  value: ReactNode;
  /** A link or button for this row, such as "Change". Name what it changes for screen readers. */
  action?: ReactNode;
}

export interface SummaryListProps {
  items: readonly SummaryItem[];
}

const present = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false;

/**
 * Facts as terms and values, such as the details of an application. From sm:
 * the terms sit in a column beside the values, with a column for row actions
 * when any row has one; below that, each row stacks. Hairlines divide the rows.
 */
export function SummaryList({ items }: SummaryListProps) {
  return (
    <dl
      className={cx(
        'grid divide-y divide-divider',
        items.some((item) => present(item.action))
          ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]'
          : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:col-span-full sm:grid sm:grid-cols-subgrid sm:items-baseline sm:gap-x-6"
        >
          <dt className="text-sm font-medium text-muted">{item.term}</dt>
          <dd className="min-w-0 text-body text-ink">{item.value}</dd>
          {present(item.action) && <dd className="sm:justify-self-end">{item.action}</dd>}
        </div>
      ))}
    </dl>
  );
}
