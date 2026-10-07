// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps, MouseEvent } from 'react';

import { cx } from './cx.ts';
import { focusElement } from './focus.ts';

export interface SkipLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  /** Id of the element that receives focus. Defaults to the main landmark's id in AppShell. */
  targetId?: string;
}

/**
 * The first stop in the tab order. It stays out of sight until it has focus,
 * then jumps past the navigation to the main content. The link is a real
 * fragment link; the click handler only moves focus, so the address bar and
 * the router are left alone.
 */
export function SkipLink({
  targetId = 'main-content',
  children = 'Skip to main content',
  className,
  onClick,
  ...rest
}: SkipLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    focusElement(target);
  }

  return (
    <a
      {...rest}
      href={`#${targetId}`}
      onClick={handleClick}
      className={cx(
        'fixed top-2 left-2 z-50 -translate-y-[200%] focus:translate-y-0',
        'inline-flex min-h-control min-w-target items-center rounded-md px-control-x',
        'bg-accent text-body font-medium text-on-accent no-underline focus:shadow-(--shadow-overlay)',
        'hover:text-on-accent',
        className,
      )}
    >
      {children}
    </a>
  );
}
