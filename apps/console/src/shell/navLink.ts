// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

/** A link in a list of pages: the shell's navigation, and the tabs of a section. The current page is marked. */
export const navLinkClassName = cx(
  'flex min-h-control items-center rounded-md px-control-x text-body text-ink no-underline',
  'hover:bg-sunken hover:text-ink',
  'aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent',
  'aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4',
);
