// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tabs as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export interface TabItem {
  /** Stable and unique. It names the tab to code, and is not shown. */
  id: string;
  /** A word or two, such as "Reviews". */
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  /** Names the set of tabs, such as "Application sections". */
  label: string;
  tabs: readonly TabItem[];
  /** The id of the tab open at first. The first tab when left out. */
  defaultTab?: string;
}

/**
 * Panels of one page that you switch between without leaving it. Tab moves
 * into the row of tabs, the arrow keys move along it and open each tab as
 * focus reaches it, and Tab again moves into the open panel. The open tab is
 * underlined and bolder. For navigation between pages, use links instead.
 */
export function Tabs({ label, tabs, defaultTab }: TabsProps) {
  return (
    <Primitive.Root defaultValue={defaultTab ?? tabs[0]?.id}>
      <Primitive.List
        aria-label={label}
        className="flex gap-x-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-divider)]"
      >
        {tabs.map((tab) => (
          <Primitive.Trigger
            key={tab.id}
            value={tab.id}
            className={cx(
              'relative flex min-h-control shrink-0 items-center px-1 text-body whitespace-nowrap text-muted',
              'transition-colors duration-(--motion-fast) ease-standard hover:text-ink',
              'aria-selected:font-semibold aria-selected:text-ink',
              // The ring sits inside the tab, where the scrolling row cannot clip it.
              'focus-visible:-outline-offset-2',
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
              'aria-selected:after:bg-accent',
            )}
          >
            {tab.label}
          </Primitive.Trigger>
        ))}
      </Primitive.List>
      {tabs.map((tab) => (
        <Primitive.Content key={tab.id} value={tab.id} className="pt-4">
          {tab.content}
        </Primitive.Content>
      ))}
    </Primitive.Root>
  );
}
