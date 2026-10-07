// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Opening a screen from a "Change" link, at an address such as
// /application/organisation#organisation-name, takes the person to that field.

import { useLocation } from '@pixel-scientists/ui';
import { useEffect } from 'react';

/**
 * Moves focus to the field the address names. The router moves focus to the
 * page's heading when a page opens, so this waits for that and goes second.
 */
export function useFocusFragment(): void {
  const { hash } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (id === '') return undefined;
    const timer = setTimeout(() => {
      document.getElementById(id)?.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [hash]);
}
