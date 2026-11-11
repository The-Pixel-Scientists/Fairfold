// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A status line for what just happened. `focus` moves focus to it: after a
 * dialog closes and the list reloads, the button that opened the dialog may
 * be gone, and the line is the one thing on the page that is still there.
 * It waits a tick, so it runs after the dialog has put focus back on its
 * opener.
 */
export function useNotice(): { notice: ReactNode; say: (text: string) => void; focus: () => void } {
  const element = useRef<HTMLParagraphElement>(null);
  const [text, setText] = useState('');
  return {
    say: setText,
    focus: () => {
      setTimeout(() => {
        element.current?.focus();
      }, 0);
    },
    notice: (
      <p ref={element} tabIndex={-1} role="status" className="text-body text-ink empty:hidden">
        {text}
      </p>
    ),
  };
}
