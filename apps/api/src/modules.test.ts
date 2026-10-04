// SPDX-License-Identifier: AGPL-3.0-or-later

import { partyRoutes } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { composeModules } from './modules.ts';

describe('composeModules', () => {
  it('registers a handler for every party route contract, once', () => {
    const { routes } = composeModules();

    expect(routes.map((route) => route.contract)).toEqual(Object.values(partyRoutes));
  });

  it('resolves every scope rule the party routes use, and none that is the platform’s', () => {
    const { resolvers } = composeModules();
    const used = new Set(Object.values(partyRoutes).map((contract) => contract.scope));

    expect(Object.keys(resolvers).sort()).toEqual(
      [...used].filter((rule) => rule !== 'tenant').sort(),
    );
  });
});
