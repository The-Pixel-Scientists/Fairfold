// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

import { useRouterContext } from './context.ts';

export const DEFAULT_LEAVE_MESSAGE =
  'You have unsaved changes. If you leave this page, you will lose them.';

/**
 * Ask before leaving a page that has unsaved changes. While `when` is true:
 *
 * - going to another page through a Link or useNavigate opens a dialog that
 *   says `message` and offers "Stay on this page" or "Leave and lose changes";
 * - the back and forward buttons open the same dialog, and stay put if the
 *   person stays;
 * - closing the tab or reloading shows the browser's own warning, which a page
 *   cannot reword.
 *
 * Changing only the search string or the hash stays on the page, so it never asks.
 */
export function useLeaveGuard(when: boolean, message: string = DEFAULT_LEAVE_MESSAGE): void {
  const { registerGuard } = useRouterContext('useLeaveGuard');

  useEffect(() => {
    if (!when) return undefined;
    const unregister = registerGuard({ message });
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [when, message, registerGuard]);
}
