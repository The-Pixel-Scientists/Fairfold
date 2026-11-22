// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the open-grants pages before sign-in, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API stubbed. In portal-production they run under the
// production Content Security Policy, which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem, signedOut, stubApi } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { LIST, ONE, ROUND_ID, round } from './programmes-api.ts';

const LONG_TITLE = `${'Eastmere'.repeat(9)} Community Garden and Allotment Association`;

interface State {
  name: string;
  path: string;
  heading: string;
  level?: number;
  handlers: Record<string, Handler>;
}

const states: State[] = [
  {
    name: 'the list',
    path: '/northfield/open-grants',
    heading: 'Open grants',
    handlers: {
      [LIST]: {
        status: 200,
        body: {
          rounds: [round, { ...round, programme: { ...round.programme, title: LONG_TITLE } }],
        },
      },
    },
  },
  {
    name: 'a round',
    path: `/northfield/open-grants/${ROUND_ID}`,
    heading: 'Programme A',
    handlers: { [ONE]: { status: 200, body: round } },
  },
  {
    name: 'the empty state',
    path: '/northfield/open-grants',
    heading: 'There are no open grants at the moment',
    level: 2,
    handlers: { [LIST]: { status: 200, body: { rounds: [] } } },
  },
  {
    name: 'the not found state',
    path: `/northfield/open-grants/${ROUND_ID}`,
    heading: 'Page not found',
    handlers: { [ONE]: problem(404, 'Not found.') },
  },
];

const h1 = (page: Page, name: string, level = 1) => page.getByRole('heading', { level, name });

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });
    test.describe.configure({ mode: 'parallel', timeout: 90_000 });

    for (const state of states) {
      test(`@a11y open grants: ${state.name} has no axe violations`, async ({ page }) => {
        await stubApi(page, { 'GET /auth/session': signedOut, ...state.handlers });
        await page.goto(state.path);
        await expect(h1(page, state.heading, state.level)).toBeVisible();
        await expect(page.getByText(/^Loading/)).toHaveCount(0);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
