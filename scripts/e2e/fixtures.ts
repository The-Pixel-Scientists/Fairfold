// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `test` and `expect` for every Playwright spec. Import them from here rather
// than from @playwright/test, and each test fails if a page breaks its
// Content Security Policy (ADR 0006): the browser fired a
// securitypolicyviolation event, or logged a violation to the console. Pages
// served without a policy, such as the Vite dev servers' pages, report none.

import { test as base, expect, type BrowserContext } from '@playwright/test';

export { expect };

/** The function each page calls to report a violation. */
const REPORT = '__tpsSecurityPolicyViolation';

/** The parts of a SecurityPolicyViolationEvent that a report names. */
interface ViolationEvent {
  violatedDirective: string;
  blockedURI: string;
  sourceFile: string;
  lineNumber: number;
}

/**
 * Collect the policy violations of every page in `context` from now on.
 * Returns a function that gives those seen so far.
 */
export async function watchSecurityPolicy(
  context: BrowserContext,
): Promise<() => Promise<string[]>> {
  const violations: string[] = [];
  await context.exposeFunction(REPORT, (violation: string) => {
    violations.push(`event: ${violation}`);
  });
  await context.addInitScript((report: string) => {
    const page = globalThis as unknown as Record<string, (violation: string) => Promise<void>> & {
      addEventListener(type: string, listener: (event: ViolationEvent) => void): void;
    };
    page.addEventListener('securitypolicyviolation', (event) => {
      // blockedURI is a URL, or "inline" or "eval".
      const where = `${event.sourceFile || 'the page'}:${String(event.lineNumber)}`;
      void page[report]?.(`${event.violatedDirective} blocked ${event.blockedURI} at ${where}`);
    });
  }, REPORT);
  context.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(`console: ${message.text()}`);
    }
  });

  return async () => {
    // A round trip to each page lets reports already on their way arrive.
    await Promise.all(
      context.pages().map((page) => page.evaluate(() => undefined).catch(() => undefined)),
    );
    return violations;
  };
}

export const test = base.extend<{ contentSecurityPolicy: undefined }>({
  contentSecurityPolicy: [
    async ({ context }, use) => {
      const violations = await watchSecurityPolicy(context);
      await use(undefined);
      expect(await violations(), 'The page broke its Content Security Policy').toEqual([]);
    },
    { auto: true },
  ],
});
