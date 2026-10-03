// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from './cx.ts';

export interface EmptyStateProps {
  /** Says what is empty, for example "No applications yet". */
  title: string;
  /** Says what to do next. */
  children: ReactNode;
  /** The next step as a button or link. */
  action?: ReactNode;
  /** The heading level, so the state fits the page's outline. Defaults to h2. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/** What a list or page shows when there is nothing to list yet, and what to do about it. */
export function EmptyState({
  title,
  children,
  action,
  headingLevel: Heading = 'h2',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex max-w-prose flex-col items-start gap-3 rounded-lg border border-dashed border-edge bg-surface p-gutter',
        className,
      )}
    >
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      <div className="text-body text-muted">{children}</div>
      {action}
    </div>
  );
}
