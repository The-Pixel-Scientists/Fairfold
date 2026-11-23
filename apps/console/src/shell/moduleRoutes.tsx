// SPDX-License-Identifier: AGPL-3.0-or-later

import { modules } from '@pixel-scientists/domain/platform';
import type { SwitchableModuleId } from '@pixel-scientists/domain/platform';
import { EmptyState, NotFoundPage, PageHeading, useSession } from '@pixel-scientists/ui';
import type { RouteDefinition } from '@pixel-scientists/ui';
import { lazy, useEffect } from 'react';

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
  // Made once, not in the page: a page that suspends on its first render keeps no state, so a lazy component made there is never the one that resolves.
  // A tool's page may itself be lazy, which React.lazy cannot resolve to, so it is rendered from a component.
  const Entry = lazy(async () => {
    const Page = (await load()).default;
    return {
      default: Page === undefined ? () => <NoScreens label={label} /> : () => <Page />,
    };
  });
  return function ModulePage() {
    const { state } = useSession();
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
    if (load === undefined) return [];
    const page = pageFor(entry, load);
    return [
      {
        path: entry.path,
        title: modules[entry.id].label,
        load: () => Promise.resolve({ default: page }),
      },
    ];
  });
}

export const moduleRoutes = moduleRoutesFor(consoleModules);

/**
 * A tool's pages below its landing page, each hidden as the landing page is
 * while the tool is off for the funder or the member holds none of its
 * permissions, and fetched only once the session shows the tool to this
 * member. The caller puts them inside the member screen.
 */
export function toolRoutes(
  id: SwitchableModuleId,
  routes: readonly RouteDefinition[],
): RouteDefinition[] {
  const entry = consoleModules.find((module) => module.id === id);
  if (entry === undefined) throw new Error(`The ${id} module has no console entry.`);
  const item = moduleItem(entry);
  return routes
    .filter((route) => route.path !== entry.path)
    .map(({ component, load, ...route }) => {
      // Made once for each page, as the landing page's is.
      const Page = load === undefined ? component : lazy(load);
      function ToolPage() {
        const { state } = useSession();
        return state.status === 'ready' && visibleItems(state.session, [item]).length > 0 ? (
          <Page />
        ) : (
          <Hidden />
        );
      }
      return { ...route, load: () => Promise.resolve({ default: ToolPage }) };
    });
}
