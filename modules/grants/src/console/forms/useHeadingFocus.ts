// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

/**
 * A page that takes the place of the one the router focused, such as the page
 * that arrives when loading ends, puts focus on its heading, as the router
 * does. It leaves focus alone when the person has already moved it.
 */
export function useHeadingFocus(): void {
  useEffect(() => {
    if (document.activeElement === document.body) document.querySelector('h1')?.focus();
  }, []);
}
