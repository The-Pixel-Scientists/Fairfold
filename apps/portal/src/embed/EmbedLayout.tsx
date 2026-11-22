// SPDX-License-Identifier: AGPL-3.0-or-later

import { MAIN_CONTENT_ID } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { useFunderName } from '../funder.tsx';

/**
 * The frame around the form on another website: the funder's name, so
 * nobody mistakes whose form it is, and the page. No navigation, sign-in or
 * account, because nothing here knows who the person is.
 */
export function EmbedLayout({ children }: { children: ReactNode }) {
  const name = useFunderName();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      {name !== null && <p className="text-body font-semibold text-ink">{name}</p>}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        {children}
      </main>
    </div>
  );
}
