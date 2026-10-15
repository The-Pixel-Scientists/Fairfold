// SPDX-License-Identifier: AGPL-3.0-or-later

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
