// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * The token from an emailed link, which carries it after `#token=`. A
 * fragment is never sent to a server or written to a log. The page reads it
 * once, keeps it in memory, and takes it out of the address bar and the
 * history entry, so it cannot be copied, bookmarked or found again by
 * pressing Back. Nothing is stored anywhere else.
 */
export function useFragmentToken(): string | null {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (hash !== '') window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }, []);

  return token;
}
