// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Every entry point in package.json's exports (`.` and `./*`) that builds
// schemas. Add a new one here when it is created.
const entries = {
  '.': () => import('../index.ts'),
  api: () => import('../api/index.ts'),
  auth: () => import('../auth/index.ts'),
  forms: () => import('../forms/index.ts'),
  platform: () => import('../platform/index.ts'),
};

afterEach(() => {
  z.config({ jitless: true });
});

it.each(Object.entries(entries))('the %s entry runs zod without eval', async (_, load) => {
  z.config({ jitless: false });
  vi.resetModules();
  await load();
  expect(z.config().jitless).toBe(true);
});
