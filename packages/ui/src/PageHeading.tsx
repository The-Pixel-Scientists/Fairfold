// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps } from 'react';

import { cx } from './cx.ts';

export type PageHeadingProps = Omit<ComponentProps<'h1'>, 'tabIndex'>;

/**
 * The one h1 of a page. The router moves focus to it after each navigation,
 * so it can take focus from script (tabindex -1) but is not a tab stop.
 */
export function PageHeading({ className, children, ...rest }: PageHeadingProps) {
  return (
    <h1
      {...rest}
      tabIndex={-1}
      className={cx('text-2xl font-semibold tracking-tight text-ink', className)}
    >
      {children}
    </h1>
  );
}
