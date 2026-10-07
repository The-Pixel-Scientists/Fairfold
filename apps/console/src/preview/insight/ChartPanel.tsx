// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel, cx } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

export interface ChartPanelProps {
  title: string;
  /** What the chart shows, in one sentence, with the number that matters. */
  takeaway: ReactNode;
  /**
   * What the chart shows in words, for people who cannot see it. The chart
   * is hidden from them, so this and the table carry it. Leave it out when
   * the chart names itself.
   */
  summary?: string;
  /** A line under the chart that explains how to read it, in text that screen readers get. */
  footnote?: ReactNode;
  /** The same data as a DataTable, behind "Show the numbers". */
  numbers: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * How every Insight chart is framed: a title, a takeaway in words, the chart
 * and the numbers behind it. The takeaway says what to notice, so the chart
 * confirms it rather than asking to be decoded.
 */
export function ChartPanel({
  title,
  takeaway,
  summary,
  footnote,
  numbers,
  className,
  children,
}: ChartPanelProps) {
  return (
    <Panel title={title} className={className}>
      <p className="-mt-2 max-w-prose text-body text-ink">{takeaway}</p>
      {summary === undefined ? (
        children
      ) : (
        <div role="img" aria-label={summary}>
          {children}
        </div>
      )}
      {footnote && <p className="-mt-1 text-sm text-muted">{footnote}</p>}
      <details className="group border-t border-divider pt-3">
        <summary
          className={cx(
            'flex min-h-target w-fit cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-muted',
            'list-none marker:hidden hover:text-ink [&::-webkit-details-marker]:hidden',
          )}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 transition-transform duration-(--motion-fast) ease-standard group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
          Show the numbers
        </summary>
        <div className="pt-3">{numbers}</div>
      </details>
    </Panel>
  );
}
