// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RouteDefinition } from '@pixel-scientists/ui';
import type { ComponentType } from 'react';

import { Screen } from '../auth/Screen.tsx';

function inMemberScreen(Page: ComponentType): ComponentType {
  return function MemberPage() {
    return (
      <Screen kind="member">
        <Page />
      </Screen>
    );
  };
}

/**
 * A module's staff pages, each inside the console's screen for a signed-in
 * member of the funder: it signs out visitors to sign in, sends people with
 * MFA still to do to it, and puts the page in the shell.
 */
export function memberRoutes(routes: readonly RouteDefinition[]): RouteDefinition[] {
  return routes.map((route) =>
    route.load
      ? {
          ...route,
          load: async () => ({ default: inMemberScreen((await route.load()).default) }),
        }
      : { ...route, component: inMemberScreen(route.component) },
  );
}
