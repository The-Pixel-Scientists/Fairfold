// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The policy and security headers as the browser receives them from each
// built app, the nonce the page is given, and a check that fixtures.ts
// catches a violation on both channels.

import { test as base, type Page } from '@playwright/test';

import { expect, test, watchSecurityPolicy } from './fixtures.ts';

const ADD_INLINE_STYLE = `document.head.append(Object.assign(document.createElement('style'), { textContent: 'body { color: red; }' }))`;

/** The nonce the page was given in Vite's meta tag. Browsers hide the attribute, not the property. */
function pageNonce(page: Page): Promise<string> {
  return page
    .locator('meta[property="csp-nonce"]')
    .evaluate((meta) => (meta as unknown as { nonce: string }).nonce);
}

test('arrives with a fresh nonce on each load, given to the page, and the security headers', async ({
  page,
}) => {
  const first = (await page.goto('/'))?.headers() ?? {};
  const firstNonce = await pageNonce(page);
  const second = (await page.reload())?.headers() ?? {};

  expect(first['content-security-policy']).toMatch(
    /^default-src 'self'; script-src 'self'; style-src 'self' 'nonce-[A-Za-z0-9+/]{22}=='; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'$/,
  );
  expect(first['content-security-policy']).toContain(`'nonce-${firstNonce}'`);
  expect(second['content-security-policy']).toContain(`'nonce-${await pageNonce(page)}'`);
  expect(second['content-security-policy']).not.toBe(first['content-security-policy']);
  expect(first).toMatchObject({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
  });
});

base('reports a violation both as an event and from the console', async ({ context, page }) => {
  const violations = await watchSecurityPolicy(context);
  await page.goto('/');

  await page.evaluate(ADD_INLINE_STYLE);

  await expect
    .poll(violations)
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^event: style-src-elem blocked inline/),
        expect.stringMatching(/^console: .*Content Security Policy/),
      ]),
    );
});

test('fails a test whose page breaks the policy', async ({ page }) => {
  test.fail();
  await page.goto('/');

  await page.evaluate(ADD_INLINE_STYLE);
});
