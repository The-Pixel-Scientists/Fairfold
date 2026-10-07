// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';

export interface PagerProps {
  /** Names the pager, such as "Submissions pages". */
  label: string;
  /** What the pages hold, in the plural, such as "submissions". */
  noun: string;
  /** The page shown, counting from 1. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * Previous and next buttons with what is on show: "Showing 1 to 20 of 48 submissions".
 * A button at either end is aria-disabled, not disabled, so it keeps focus.
 */
export function Pager({ label, noun, page, pageSize, total, onPageChange }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-body text-muted"
    >
      <p aria-live="polite" className="tabular-nums">
        {total === 0
          ? `No ${noun} to show`
          : `Showing ${String(from)} to ${String(to)} of ${String(total)} ${noun}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="whitespace-nowrap"
          aria-disabled={page <= 1 || undefined}
          onClick={() => {
            if (page > 1) onPageChange(page - 1);
          }}
        >
          Previous page
        </Button>
        <span className="px-1 tabular-nums">
          Page {page} of {pages}
        </span>
        <Button
          className="whitespace-nowrap"
          aria-disabled={page >= pages || undefined}
          onClick={() => {
            if (page < pages) onPageChange(page + 1);
          }}
        >
          Next page
        </Button>
      </div>
    </nav>
  );
}
