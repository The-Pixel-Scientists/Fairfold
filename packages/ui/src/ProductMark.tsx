// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from './cx.ts';

/**
 * The suite's mark: a folded tile with an F cut out of it. Decoration only,
 * in the text colour, so it follows the colour scheme; the product name
 * beside it says what it is.
 */
export function ProductMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="3.95 -0.25 5.5 5.5"
      className={cx('h-5 w-auto shrink-0', className)}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.65 0 H8.75 A0.45 0.45 0 0 1 9.2 0.45 V4.55 A0.45 0.45 0 0 1 8.75 5 H5.45 A0.45 0.45 0 0 1 5 4.55 L4.2 0.45 A0.45 0.45 0 0 1 4.65 0 Z M6.15 1 L8.25 1 L8.25 1.6 L6.75 1.6 L6.75 2.2 L7.8 2.2 L7.8 2.8 L6.75 2.8 L6.75 4 L6.15 4 Z"
      />
    </svg>
  );
}
