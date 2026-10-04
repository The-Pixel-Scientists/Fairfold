// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell, Link, cx } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { productName } from '../product.ts';
import { AccountControls } from './AccountControls.tsx';
import { visibleItems } from './navigation.ts';
import type { NavigationItem } from './navigation.ts';

const linkClassName = cx(
  'flex min-h-control items-center rounded-md px-control-x text-body text-ink no-underline',
  'hover:bg-sunken hover:text-ink',
  'aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent',
  'aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4',
);

function Navigation({ items }: { items: readonly NavigationItem[] }) {
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      {items.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className={linkClassName}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The frame around the console's pages for a signed-in member of the funder. */
export function ConsoleShell({ session, children }: { session: SessionData; children: ReactNode }) {
  const items = visibleItems(session);
  return (
    <AppShell
      productName={productName}
      homeHref="/"
      areaName="Staff console"
      navigation={items.length > 0 ? <Navigation items={items} /> : undefined}
      actions={<AccountControls session={session} />}
    >
      {children}
    </AppShell>
  );
}
