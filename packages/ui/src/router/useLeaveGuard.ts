// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

import { useRouterContext } from './context.ts';

export const DEFAULT_LEAVE_MESSAGE =
  'Leave this page? You have unsaved changes, and you will lose them if you leave.';

/**
 * Ask before leaving a page that has unsaved changes. While `when` is true:
 *
 * - going to another page through a Link or useNavigate asks first;
 * - the back and forward buttons ask first, and stay put if you decline;
 * - closing the tab or reloading shows the browser's own warning.
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
