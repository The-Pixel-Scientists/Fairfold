// SPDX-License-Identifier: AGPL-3.0-or-later

import { Notice } from '@pixel-scientists/ui';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * The success message after an action. The button that was pressed has gone,
 * so focus moves here on mount and the group's name is read out; a live region
 * that appears already filled is not reliably announced.
 */
export function Outcome({ title, children }: { title: string; children: ReactNode }) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    group.current?.focus();
  }, []);
  return (
    <div ref={group} tabIndex={-1} role="group" aria-label={title} className="rounded-lg">
      <Notice tone="success" title={title}>
        {children}
      </Notice>
    </div>
  );
}
