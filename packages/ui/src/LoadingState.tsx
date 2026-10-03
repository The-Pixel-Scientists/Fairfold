// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from './cx.ts';

export interface LoadingStateProps {
  /** Says what is loading. Defaults to "Loading". */
  label?: string;
  className?: string;
}

/**
 * A visual cue for a page or list that is loading. The words are always
 * there; the spinner is decoration and stands still when the person has asked
 * for reduced motion. A live region that arrives with its text is not reliably
 * announced, so announce a result from a status element that is always on the
 * page and fill it in when there is something to say.
 */
export function LoadingState({ label = 'Loading', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cx('flex items-center gap-3 p-gutter text-body text-muted', className)}
    >
      <span
        aria-hidden="true"
        className="size-4 shrink-0 rounded-full border-2 border-divider border-t-accent motion-safe:animate-spin"
      />
      <span>{label}…</span>
    </div>
  );
}
