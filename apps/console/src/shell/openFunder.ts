// SPDX-License-Identifier: AGPL-3.0-or-later

/** Opens a funder's console from the start, so the page, the session and the router all begin under its slug. */
export function openFunder(slug: string): void {
  window.location.assign(`/${slug}/`);
}
