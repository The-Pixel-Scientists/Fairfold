// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '../cx.ts';

export interface SectionProgressProps {
  /** The section the person is on, counting from 1. */
  current: number;
  /** How many sections the application has. */
  total: number;
  /** The section's name, such as "Budget". */
  title?: string;
}

/**
 * "Section 3 of 6", with the section's name if you give it, above a thin bar
 * of one segment for each section. The words carry the meaning, so the bar is
 * hidden from assistive technology.
 */
export function SectionProgress({ current, total, title }: SectionProgressProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        <span className="font-medium text-ink tabular-nums">
          Section {current} of {total}
        </span>
        {title !== undefined && (
          <>
            <span className="sr-only">: </span>
            <span aria-hidden="true"> · </span>
            {title}
          </>
        )}
      </p>
      <div aria-hidden="true" className="flex gap-1">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cx('h-1 flex-1 rounded-full', index < current ? 'bg-accent' : 'bg-divider')}
          />
        ))}
      </div>
    </div>
  );
}
