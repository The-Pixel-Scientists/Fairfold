// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sets the colour scheme on the page element before the first paint, so a
// dark page never flashes white: the scheme the person chose in this browser,
// if any (ColourSchemeSwitch keeps it), otherwise their device's. A plain
// script in the head of index.html, without defer, because the policy allows
// no inline script (ADR 0006). src/scheme/colourScheme.ts keeps it up to date
// once the app runs.

/* global window, document */

(() => {
  /** @type {string | null} */
  let choice = null;
  try {
    choice = window.localStorage.getItem('colour-scheme');
  } catch {
    // Storage can be blocked; the device's scheme still applies.
  }
  const dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
})();
