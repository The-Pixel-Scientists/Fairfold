// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeading } from '@pixel-scientists/ui';
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

/** The page's heading, and the few plain sentences under it that say what this screen is for. */
export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading className="text-3xl sm:text-4xl">{title}</PageHeading>
      {children ? (
        <div className="flex max-w-prose flex-col gap-4 text-lg text-ink">{children}</div>
      ) : null}
    </div>
  );
}
