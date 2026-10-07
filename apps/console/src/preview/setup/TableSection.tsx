// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/** A heading over a table, so heading navigation finds it. The table keeps the same name for its own region. */
export function TableSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </div>
  );
}
