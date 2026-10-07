// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from './cx.ts';
import { ProductMark } from './ProductMark.tsx';
import { Link } from './router/Link.tsx';
import { ColourSchemeSwitch } from './scheme/ColourSchemeSwitch.tsx';
import { SkipLink } from './SkipLink.tsx';

/** The id of the main landmark, and the skip link's target. */
export const MAIN_CONTENT_ID = 'main-content';

export interface AppShellProps {
  /** Shown in the header, for example "Fairfold Grants". */
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

const productNameClassName =
  'inline-flex min-h-control items-center gap-2.5 text-lg font-semibold tracking-tight text-ink';

/**
 * The frame around every page: a skip link, a header, navigation, the main
 * landmark and a footer with the colour scheme switch. With navigation, wide
 * screens put it in a side column and the page on a sheet beside it; narrow
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
  const product = (
    <>
      <ProductMark />
      {productName}
    </>
  );

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
        <header
          className={cx(
            'col-span-full flex flex-wrap items-center justify-between gap-x-gutter gap-y-2 border-b border-divider px-gutter py-2',
            hasNavigation && 'md:border-b-0 md:pl-5',
          )}
        >
          <p className="flex flex-wrap items-center gap-x-3">
            {homeHref === undefined ? (
              <span className={productNameClassName}>{product}</span>
            ) : (
              <Link
                to={homeHref}
                className={cx(productNameClassName, 'no-underline hover:text-ink hover:underline')}
              >
                {product}
              </Link>
            )}
            {areaName && (
              <>
                <span aria-hidden="true" className="h-4 w-px bg-edge" />
                <span className="text-body text-muted">{areaName}</span>
              </>
            )}
          </p>
          {actions && <div className="flex flex-wrap items-center gap-x-2 gap-y-2">{actions}</div>}
        </header>
        {hasNavigation && (
          <nav
            aria-label={navigationLabel}
            className="border-b border-divider px-gutter py-3 md:border-b-0 md:px-3 md:py-2"
          >
            {navigation}
          </nav>
        )}
        <div
          className={cx(
            'col-span-full flex min-w-0 flex-col',
            hasNavigation && 'md:col-span-1 md:pr-3',
          )}
        >
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className={cx(
              'min-w-0 flex-1 px-gutter py-6',
              hasNavigation &&
                'md:rounded-lg md:border md:border-divider md:bg-surface md:px-10 md:py-9 md:shadow-(--shadow-raised)',
            )}
          >
            {children}
          </main>
          <footer className="flex flex-wrap items-center justify-end gap-3 px-gutter py-3">
            <ColourSchemeSwitch />
          </footer>
        </div>
      </div>
    </div>
  );
}
