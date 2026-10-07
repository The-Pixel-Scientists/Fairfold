// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

/**
 * A link in the shell's navigation. The current page is marked three ways:
 * a sheet behind it, heavier ink, and a bar at its start. So is the section
 * the current page is in.
 */
export const navLinkClassName = cx(
  'relative flex min-h-control items-center rounded-md px-3 text-body text-muted no-underline',
  'transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken hover:text-ink',
  'aria-[current]:bg-surface aria-[current]:font-semibold aria-[current]:text-ink',
  'aria-[current]:shadow-(--shadow-raised)',
  'aria-[current]:before:absolute aria-[current]:before:inset-y-2 aria-[current]:before:left-0',
  "aria-[current]:before:w-[3px] aria-[current]:before:rounded-full aria-[current]:before:bg-accent aria-[current]:before:content-['']",
);

/** A tab in a section's own navigation, such as the settings pages. The current one is underlined and heavier. */
export const tabLinkClassName = cx(
  'relative flex min-h-control items-center text-body text-muted no-underline hover:text-ink',
  'aria-[current]:font-semibold aria-[current]:text-ink',
  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:content-['']",
  'aria-[current]:after:bg-accent',
);
