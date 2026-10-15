// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Fetch, JsonRouteContract, RouteContract } from '@pixel-scientists/domain/api';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

afterEach(() => {
  z.config({ jitless: true });
});

// Loading every contract afresh takes several seconds on a busy machine,
// past Vitest's five-second default.
it('runs zod without eval', { timeout: 30_000 }, async () => {
  z.config({ jitless: false });
  vi.resetModules();
  await import('./index.ts');
  expect(z.config().jitless).toBe(true);
});

it(
  'exports only routes that keep every rule, with no raw route for call() or a reviewer',
  {
    timeout: 30_000,
  },
  async () => {
    // From the same module registry as the contracts, which the test above resets.
    const { call, checkRoute, isRawBody } = await import('@pixel-scientists/domain/api');
    const routes = Object.values<unknown>(await import('./index.ts')).filter(
      (value): value is RouteContract =>
        typeof value === 'object' && value !== null && 'audience' in value && 'path' in value,
    );
    expect(routes.length).toBeGreaterThan(0);
    const fetch = vi.fn<Fetch>();
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      if (!isRawBody(route.body) && !Object.values(route.responses).some(isRawBody)) continue;
      expect(route.scope, route.path).not.toBe('assigned_review');
      await expect(call(route as JsonRouteContract, {}, { fetch }), route.path).rejects.toThrow(
        TypeError,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  },
);
