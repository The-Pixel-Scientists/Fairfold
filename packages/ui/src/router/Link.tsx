// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps, MouseEvent } from 'react';

import { useRouterContext } from './context.ts';
import { resolveAppPath } from './paths.ts';

export interface LinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  /** A path inside the app, such as `/applications/42?tab=notes`. Anything else throws. */
  to: string;
  /**
   * For a section in navigation: while a page under `to` is open, such as
   * `/settings/look` under `/settings`, the link gets `aria-current="true"`.
   */
  section?: boolean;
}

const trimSlashes = (pathname: string): string => pathname.replace(/\/+$/, '');

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A real `<a href>`, so opening in a new tab, copying the address and
 * assistive technology's link list all work. Only a plain left click is
 * handled here; any other click is left to the browser. The link to the
 * current page gets `aria-current="page"`, and a section link
 * `aria-current="true"` while a page in it is open.
 *
 * Link goes to another page. It does not scroll to a `#hash`, so for a link
 * to somewhere on the same page use a plain `<a href="#id">`.
 */
export function Link({ to, section = false, onClick, target, children, ...rest }: LinkProps) {
  const { basePath, location, navigate } = useRouterContext('Link');
  const { location: destination, href } = resolveAppPath(basePath, to);
  const here = trimSlashes(location.pathname);
  const there = trimSlashes(destination.pathname);
  const current =
    here === there ? 'page' : section && here.startsWith(`${there}/`) ? 'true' : undefined;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !isPlainLeftClick(event)) return;
    if (target !== undefined && target !== '_self') return;
    if (rest.download !== undefined) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a aria-current={current} {...rest} target={target} href={href} onClick={handleClick}>
      {children}
    </a>
  );
}
