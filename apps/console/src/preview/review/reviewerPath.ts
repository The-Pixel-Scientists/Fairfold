// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A reviewer's own pages: their inbox and each review. The score spread is a
 * staff page. A static host adds a trailing slash, so it is ignored.
 */
export function isReviewerPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return path === '/reviews' || (path.startsWith('/reviews/') && path !== '/reviews/spread');
}
