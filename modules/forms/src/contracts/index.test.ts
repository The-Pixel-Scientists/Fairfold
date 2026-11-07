// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RouteContract } from '@pixel-scientists/domain/api';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

afterEach(() => {
  z.config({ jitless: true });
});

// Loading every contract afresh can take several seconds on a busy machine.
it('runs zod without eval', { timeout: 30_000 }, async () => {
  z.config({ jitless: false });
  vi.resetModules();
  await import('./index.ts');
  expect(z.config().jitless).toBe(true);
});

it(
  'exports only routes that keep every rule, with the full entry loaded',
  { timeout: 30_000 },
  async () => {
    // From the same module registry as the contracts, which the test above resets.
    const { checkRoute } = await import('@pixel-scientists/domain/api');
    const routes = Object.values<unknown>(await import('./index.ts')).filter(
      (value): value is RouteContract =>
        typeof value === 'object' && value !== null && 'audience' in value && 'path' in value,
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  },
);
