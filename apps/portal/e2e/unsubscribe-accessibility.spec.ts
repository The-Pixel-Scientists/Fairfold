// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the unsubscribe page and every state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme. The page has no session or funder look, so it is always in the
// default look. In portal-production they run under the production Content
// Security Policy, which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem, stubApi } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { GET, PATH, POST, REFUSED, outcome, target } from './unsubscribe-api.ts';

interface State {
  name: string;
  handlers: Record<string, Handler>;
  /** Where the page starts; the link's own address by default. */
  path?: string;
  heading: string;
  act?: (page: Page) => Promise<void>;
}

const press = (page: Page) =>
  page.getByRole('button', { name: 'Unsubscribe from these emails' }).click();

const states: State[] = [
  {
    name: 'ready to unsubscribe',
    handlers: { [GET]: target },
    heading: 'Stop emails about future funding',
  },
  {
    name: 'unsubscribed',
    handlers: { [GET]: target, [POST]: outcome('unsubscribed') },
    heading: 'You have unsubscribed',
    act: press,
  },
  {
    name: 'a link that does not work',
    handlers: { [GET]: problem(404, 'Not found.') },
    heading: REFUSED,
  },
  {
    name: 'a malformed link',
    handlers: {},
    path: '/northfield/unsubscribe?token=x',
    heading: REFUSED,
  },
  {
    name: 'too many attempts',
    handlers: { [GET]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } } },
    heading: 'Unsubscribe',
  },
  {
    name: 'a failed unsubscribe',
    handlers: { [GET]: target, [POST]: problem(503, 'The service is busy.') },
    heading: 'Stop emails about future funding',
    act: async (page) => {
      await press(page);
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });
    test.describe.configure({ mode: 'parallel', timeout: 90_000 });

    for (const state of states) {
      test(`@a11y unsubscribe: ${state.name} has no axe violations`, async ({ page }) => {
        await stubApi(page, state.handlers);
        await page.goto(state.path ?? PATH);
        await state.act?.(page);
        await expect(page.getByRole('heading', { level: 1, name: state.heading })).toBeVisible();
        await expect(page.getByText(/^Loading/)).toHaveCount(0);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
