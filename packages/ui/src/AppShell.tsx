// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from './cx.ts';
import { Link } from './router/Link.tsx';
import { SkipLink } from './SkipLink.tsx';

/** The id of the main landmark, and the skip link's target. */
export const MAIN_CONTENT_ID = 'main-content';

export interface AppShellProps {
  /** Shown in the header, for example "PixelGrant". */
  productName: string;
  /**
   * A path inside the app, such as `/`. When set, the product name links to it.
   * The shell must then sit inside a Router.
   */
  homeHref?: string;
  /** Names the area under the product name, for example "Staff console". */
  areaName?: string;
  /**
   * The contents of the main navigation, normally a list of links. Leave it
   * out and the shell has no navigation landmark.
   */
  navigation?: ReactNode;
  /** The accessible name of the navigation landmark. Defaults to "Main". */
  navigationLabel?: string;
  /** Controls at the end of the header, such as account actions. */
  actions?: ReactNode;
  /** Compact for the console, comfortable for roomier screens. Defaults to compact. */
  density?: 'compact' | 'comfortable';
  /** The page. It goes inside the main landmark. */
  children: ReactNode;
}

const productNameClassName = 'text-lg font-semibold text-ink';

/**
 * The frame around every console page: a skip link, a header, navigation and
 * the main landmark. Wide screens put navigation in a side column; narrow
 * ones stack it under the header, so nothing scrolls sideways at 320px.
 * Nothing is sticky, so a focused element is never hidden behind the header.
 */
export function AppShell({
  productName,
  homeHref,
  areaName,
  navigation,
  navigationLabel = 'Main',
  actions,
  density = 'compact',
  children,
}: AppShellProps) {
  const hasNavigation = navigation !== undefined && navigation !== null && navigation !== false;

  return (
    <div data-density={density} className="min-h-dvh bg-canvas text-ink">
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <div
        className={cx(
          'grid min-h-dvh grid-cols-1',
          hasNavigation
            ? 'grid-rows-[auto_auto_1fr] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] md:grid-rows-[auto_1fr]'
            : 'grid-rows-[auto_1fr]',
        )}
      >
        <header className="col-span-full flex flex-wrap items-center justify-between gap-x-gutter gap-y-2 border-b border-divider bg-surface px-gutter py-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            {homeHref === undefined ? (
              <span className={productNameClassName}>{productName}</span>
            ) : (
              <Link
                to={homeHref}
                className={cx(
                  productNameClassName,
                  'inline-flex min-h-control items-center no-underline hover:text-ink hover:underline',
                )}
              >
                {productName}
              </Link>
            )}
            {areaName && <span className="text-body text-muted">{areaName}</span>}
          </p>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {hasNavigation && (
          <nav
            aria-label={navigationLabel}
            className="border-b border-divider bg-surface px-gutter py-3 md:border-r md:border-b-0 md:py-gutter"
          >
            {navigation}
          </nav>
        )}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="col-span-full min-w-0 p-gutter md:col-span-1"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
