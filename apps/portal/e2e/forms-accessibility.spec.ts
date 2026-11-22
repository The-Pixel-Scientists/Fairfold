// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every forms page and state, at desktop width, at 320 px wide
// and at 200% zoom (ADR 0006), and at desktop width in the dark scheme, in the
// funder's standard look and in a saved custom look, with the API stubbed from
// the contracts (forms-api.ts). In portal-production they run under the
// production Content Security Policy, which the test fixture holds every page
// to. The embed entry is checked here under the portal's policy; its own
// policy is S12-75's spec.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { custom } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import {
  FORM_ID,
  notFound,
  PUBLIC_ROUTES,
  RESPONSE_ID,
  stubPublicForm,
  stubSignedInForms,
  SUBMITTED,
} from './forms-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const publicAddress = `/northfield/forms/${FORM_ID}`;

async function openEmbed(page: Page) {
  await page.goto('/embed.html');
  await page.evaluate((path) => {
    window.history.replaceState(null, '', path);
  }, publicAddress);
  await page.reload();
}

async function toSection(page: Page) {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(h1(page, 'About you')).toBeVisible();
}

async function toReview(page: Page) {
  await toSection(page);
  await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and check your answers' }).click();
  await expect(h1(page, 'Check your answers')).toBeVisible();
}

interface State {
  name: string;
  /** Stubs the API and opens the page in the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'public form, first screen',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await expect(h1(page, 'Funder A feedback')).toBeVisible();
    },
  },
  {
    name: 'public form, first screen in a custom look',
    open: async (page) => {
      await stubPublicForm(page, {}, custom);
      await page.goto(publicAddress);
      await expect(h1(page, 'Funder A feedback')).toBeVisible();
    },
  },
  {
    name: 'public form, a section',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await toSection(page);
    },
  },
  {
    name: 'public form, a section with a problem',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await toSection(page);
      await page.getByRole('textbox', { name: /Your town/ }).fill('x'.repeat(600));
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeVisible();
    },
  },
  {
    name: 'public form, review',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await toReview(page);
    },
  },
  {
    name: 'public form, review with an unanswered question',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await page.getByRole('button', { name: 'Start' }).click();
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await page.getByRole('button', { name: 'Save and check your answers' }).click();
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await expect(page.getByText('One question needs your attention')).toBeVisible();
    },
  },
  {
    name: 'public form, a send that was refused',
    open: async (page) => {
      await stubPublicForm(page, {
        [PUBLIC_ROUTES.submit]: {
          status: 429,
          headers: { 'retry-after': '30' },
          body: {
            type: 'about:blank',
            title: 'Too many requests',
            status: 429,
            detail: 'Slow down.',
            requestId: 'req_e2e',
          },
        },
      });
      await page.goto(publicAddress);
      await toReview(page);
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await expect(page.getByText(/Wait 30 seconds/)).toBeVisible();
    },
  },
  {
    name: 'public form, sent',
    open: async (page) => {
      await stubPublicForm(page);
      await page.goto(publicAddress);
      await toReview(page);
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await expect(h1(page, SUBMITTED)).toBeVisible();
    },
  },
  {
    name: 'public form that cannot be found',
    open: async (page) => {
      await stubPublicForm(page, { [PUBLIC_ROUTES.form]: notFound });
      await page.goto(publicAddress);
      await expect(h1(page, 'We cannot find this form')).toBeVisible();
    },
  },
  {
    name: 'embedded form, first screen',
    open: async (page) => {
      await stubPublicForm(page);
      await openEmbed(page);
      await expect(h1(page, 'Funder A feedback')).toBeVisible();
    },
  },
  {
    name: 'embedded form, review',
    open: async (page) => {
      await stubPublicForm(page);
      await openEmbed(page);
      await toReview(page);
    },
  },
  {
    name: 'your answers',
    open: async (page) => {
      await stubSignedInForms(page);
      await page.goto('/northfield/form-responses');
      await expect(h1(page, 'Your answers')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Funder A survey' })).toBeVisible();
    },
  },
  {
    name: 'your answers with none sent',
    open: async (page) => {
      await stubSignedInForms(
        page,
        {},
        {
          'GET /portal/form-responses': { status: 200, body: { responses: [], nextCursor: null } },
        },
      );
      await page.goto('/northfield/form-responses');
      await expect(page.getByText('You have not sent any answers yet')).toBeVisible();
    },
  },
  {
    name: 'one answered form',
    open: async (page) => {
      await stubSignedInForms(page);
      await page.goto(`/northfield/form-responses/${RESPONSE_ID}`);
      await expect(h1(page, 'Funder A survey')).toBeVisible();
      await expect(page.getByText('Sam', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'signed-in form, a section, saved',
    open: async (page) => {
      await stubSignedInForms(page);
      await page.goto(`/northfield/your-forms/${FORM_ID}`);
      await toSection(page);
      await page.getByRole('textbox', { name: /Your name/ }).fill('Sam');
      await expect(page.getByText(/Saved at/)).toBeVisible();
    },
  },
  {
    name: 'signed-in form that cannot be found',
    open: async (page) => {
      await stubSignedInForms(page, { modules: [] });
      await page.goto(`/northfield/your-forms/${FORM_ID}`);
      await expect(h1(page, 'Page not found')).toBeVisible();
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

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await state.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
