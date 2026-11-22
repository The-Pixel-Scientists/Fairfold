// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for "How we contact you" and each state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, in the default and a custom look. In portal-production they run
// under the production Content Security Policy, which the test fixture holds
// every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { custom, problem, standard, stubSignedIn } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { LABEL, PREFERENCES, choices } from './preferences-api.ts';

interface State {
  name: string;
  handlers: Record<string, Handler>;
  /** What to wait for, once the page is in the state. */
  ready: (page: Page) => Promise<void>;
  act?: (page: Page) => Promise<void>;
}

const turnOffAndSave = async (page: Page) => {
  await page.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('button', { name: 'Save my choice' }).click();
};

const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

const states: State[] = [
  {
    name: 'a choice made',
    handlers: { [`GET ${PREFERENCES}`]: choices('given') },
    ready: (page) => expect(page.getByRole('group', { name: LABEL })).toBeVisible(),
  },
  {
    name: 'a choice turned off',
    handlers: { [`GET ${PREFERENCES}`]: choices('withdrawn') },
    ready: (page) =>
      expect(page.getByText('You turned this off. You can turn it back on here.')).toBeVisible(),
  },
  {
    name: 'no choice yet, with a problem',
    handlers: { [`GET ${PREFERENCES}`]: choices(null) },
    ready: (page) => expect(summary(page)).toBeFocused(),
    act: (page) => page.getByRole('button', { name: 'Save my choice' }).click(),
  },
  {
    name: 'a choice saved',
    handlers: {
      [`GET ${PREFERENCES}`]: choices('given'),
      [`PUT ${PREFERENCES}`]: choices('withdrawn'),
    },
    ready: (page) => expect(page.getByText(`Saved. ${LABEL}: no.`)).toBeVisible(),
    act: turnOffAndSave,
  },
  {
    name: 'a refusal',
    handlers: {
      [`GET ${PREFERENCES}`]: choices('given'),
      [`PUT ${PREFERENCES}`]: problem(403, 'You cannot change this.'),
    },
    ready: (page) => expect(summary(page)).toBeFocused(),
    act: turnOffAndSave,
  },
  {
    name: 'choices that could not be loaded',
    handlers: { [`GET ${PREFERENCES}`]: problem(503, 'The service is busy.') },
    ready: (page) => expect(page.getByRole('button', { name: 'Try again' })).toBeVisible(),
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

    for (const [look, funder] of [
      ['default look', standard],
      ['custom look', custom],
    ] as const) {
      for (const state of states) {
        test(`@a11y how we contact you: ${state.name} in the ${look} has no axe violations`, async ({
          page,
        }) => {
          await stubSignedIn(page, {}, state.handlers, funder);
          await page.goto('/northfield/preferences');
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await state.act?.(page);
          await state.ready(page);
          await expect(page.getByText(/^Loading/)).toHaveCount(0);

          await expectNoViolations(page);
          await expectNoHorizontalScroll(page);
        });
      }
    }
  });
}
