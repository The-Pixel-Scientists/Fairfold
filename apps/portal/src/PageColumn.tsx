// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * One centred column of readable width, with room above and between its
 * parts. Every portal page sits in one, so a screen holds a single task.
 */
export function PageColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4 sm:py-10">{children}</div>
  );
}
