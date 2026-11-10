// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSession } from '@pixel-scientists/ui';
import type { SessionState } from '@pixel-scientists/ui';
import type { ComponentType } from 'react';
import { useEffect } from 'react';
import type { RouteDefinition } from '@pixel-scientists/ui';

import { isVisible } from './modules.ts';
import type { PortalModule } from './modules.ts';

/** A tool's routes and the section they belong to. */
export interface Tool {
  entry: PortalModule;
  routes: readonly RouteDefinition[];
}

/**
 * The tool's page, which fetches the tool's code once the session is read.
 * Until then, or when nobody is signed in, the page shows its own loading and
 * sign-in screens.
 */
function loading(entry: PortalModule, Page: ComponentType): ComponentType {
  return function ModulePage() {
    const { state } = useSession();
    const ready = state.status === 'ready';
    useEffect(() => {
      if (ready) void entry.load();
    }, [ready]);
    return <Page />;
  };
}

/** The tool's routes, each fetching the tool's code when first opened. */
export function toolRoutes(entry: PortalModule, routes: readonly RouteDefinition[]): Tool {
  return {
    entry,
    routes: routes.map((route) => {
      const { component, load, ...rest } = route;
      return component !== undefined
        ? { ...rest, component: loading(entry, component) }
        : {
            ...rest,
            load: async () => ({ default: loading(entry, (await load()).default) }),
          };
    }),
  };
}

/**
 * The routes the router is given: a tool's are left out once the session
 * shows the tool is off or not for this person. Its addresses then reach the
 * router's own not-found page, with that page's title, announcement and focus,
 * so nothing says the tool exists. The server's refusal is the real control.
 */
export function routesFor(
  state: SessionState,
  own: readonly RouteDefinition[],
  tools: readonly Tool[],
): readonly RouteDefinition[] {
  return [
    ...own,
    ...tools
      .filter(({ entry }) => state.status !== 'ready' || isVisible(state.session, entry))
      .flatMap(({ routes }) => routes),
  ];
}
