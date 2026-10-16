// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `test` and `expect` for every Playwright spec. Import them from here rather
// than from @playwright/test, and each test fails if a page breaks its
// Content Security Policy (ADR 0006): the browser fired a
// securitypolicyviolation event, or logged a violation to the console. Pages
// served without a policy, such as the Vite dev servers' pages, report none.
//
// In Firefox, the first navigation of a new page is sent again if the browser
// has not reported it after FIRST_NAVIGATION_MS. Playwright's Firefox driver
// sometimes loses that navigation: in CI, a few tests a run timed out
// in page.goto although every request had been answered within milliseconds
// and the page had rendered. Each server answer carries
// Cross-Origin-Opener-Policy, which moves the page out of about:blank's
// browsing context group, and Chromium and WebKit never lost one. A page that
// really does not load still fails, as the second try waits the full timeout.

import { test as base, errors, expect, type BrowserContext, type Page } from '@playwright/test';

export { expect };

/** How long Firefox has to report the first navigation of a page before it is sent again. */
const FIRST_NAVIGATION_MS = 15_000;

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

/** Send the first navigation of `page` again if Firefox does not report it in time. */
function retryFirstNavigation(page: Page): void {
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    if (page.url() !== 'about:blank') return goto(url, options);
    const timeout = Math.min(options?.timeout ?? FIRST_NAVIGATION_MS, FIRST_NAVIGATION_MS);
    try {
      return await goto(url, { ...options, timeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      return goto(url, options);
    }
  };
}

export const test = base.extend<{ contentSecurityPolicy: undefined }>({
  page: async ({ page, browserName }, use) => {
    if (browserName === 'firefox') retryFirstNavigation(page);
    await use(page);
  },
  contentSecurityPolicy: [
    async ({ context }, use) => {
      const violations = await watchSecurityPolicy(context);
      await use(undefined);
      expect(await violations(), 'The page broke its Content Security Policy').toEqual([]);
    },
    { auto: true },
  ],
});
