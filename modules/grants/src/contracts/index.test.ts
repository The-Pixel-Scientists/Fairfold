// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

afterEach(() => {
  z.config({ jitless: true });
});

it('runs zod without eval', async () => {
  z.config({ jitless: false });
  vi.resetModules();
  await import('./index.ts');
  expect(z.config().jitless).toBe(true);
});
