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
        'flex max-w-prose flex-col items-start gap-3 rounded-lg border border-dashed border-edge/70 p-gutter sm:p-8',
        className,
      )}
    >
      {/* A blank sheet with its corner folded: decoration only. */}
      <span
        aria-hidden="true"
        className="mb-1 grid size-10 place-items-center rounded-md border border-divider bg-surface text-muted shadow-(--shadow-raised)"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        >
          <path d="M5 2.75h6.75l3.25 3.25v11.25H5z" />
          <path d="M11.75 2.75V6H15" />
        </svg>
      </span>
      <Heading className="text-lg font-semibold tracking-tight text-ink">{title}</Heading>
      <div className="flex flex-col gap-2 text-body text-muted">{children}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
