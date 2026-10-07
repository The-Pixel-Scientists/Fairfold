// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from '../router/Link.tsx';

export interface BreadcrumbItem {
  label: string;
  /** A path inside the app. Leave it out for an ancestor that has no page of its own. */
  to?: string;
}

export interface BreadcrumbsProps {
  /** From the top of the site down to the current page, which comes last. */
  items: readonly BreadcrumbItem[];
}

/**
 * Where the page sits: each ancestor links to its page, and the last item is
 * the current page, in plain text. The separators are decoration, so a screen
 * reader hears an ordered list of links. It wraps on narrow screens.
 */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} className="flex min-h-target items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="font-medium text-ink">
                  {item.label}
                </span>
              ) : item.to === undefined ? (
                <span>{item.label}</span>
              ) : (
                <Link
                  to={item.to}
                  className="inline-flex min-h-target items-center text-muted hover:text-ink"
                >
                  {item.label}
                </Link>
              )}
              {!last && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-3.5 shrink-0 text-edge"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 3.5 4.5 4.5L6 12.5" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
