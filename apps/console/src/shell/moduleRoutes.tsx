// SPDX-License-Identifier: AGPL-3.0-or-later

import { modules } from '@pixel-scientists/domain/platform';
import { EmptyState, NotFoundPage, PageHeading, useSession } from '@pixel-scientists/ui';
import type { RouteDefinition } from '@pixel-scientists/ui';
import { lazy, useEffect, useState } from 'react';

import { consoleModules } from '../modules.ts';
import type { ConsoleModule } from '../modules.ts';
import { titleSuffix } from '../product.ts';
import { moduleItem, visibleItems } from './navigation.ts';

function NoScreens({ label }: { label: string }) {
  return (
    <>
      <PageHeading>{label}</PageHeading>
      <EmptyState title="No screens yet">
        {label} has nothing to open yet. Its screens appear here as they are added.
      </EmptyState>
    </>
  );
}

/** What a funder without the tool, or a member without its permissions, sees: the same page as for any address that is not there. */
function Hidden() {
  useEffect(() => {
    // The router sets the tool's title first; this runs after it.
    const timer = setTimeout(() => {
      document.title = `Page not found – ${titleSuffix}`;
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return <NotFoundPage />;
}

/** The tool's code is fetched only once the session shows the tool to this member. */
function pageFor(entry: ConsoleModule, load: NonNullable<ConsoleModule['load']>) {
  const item = moduleItem(entry);
  const label = modules[entry.id].label;
  return function ModulePage() {
    const { state } = useSession();
    const [Entry] = useState(() =>
      lazy(async () => ({
        default: (await load()).default ?? (() => <NoScreens label={label} />),
      })),
    );
    return state.status === 'ready' && visibleItems(state.session, [item]).length > 0 ? (
      <Entry />
    ) : (
      <Hidden />
    );
  };
}

/** The tools' landing routes. The caller puts them inside the member screen. */
export function moduleRoutesFor(entries: readonly ConsoleModule[]): RouteDefinition[] {
  return entries.flatMap((entry) => {
    const { load } = entry;
    return load === undefined
      ? []
      : [
          {
            path: entry.path,
            title: modules[entry.id].label,
            load: () => Promise.resolve({ default: pageFor(entry, load) }),
          },
        ];
  });
}

export const moduleRoutes = moduleRoutesFor(consoleModules);
