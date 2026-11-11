// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the screens that show more time, an application the funder sent
// and what was sent, and for the equality monitoring step in each state, at
// desktop width, at 320 px wide and at 200% zoom (ADR 0006), and at desktop width
// in the dark scheme, with the API stubbed. In portal-production they run under
// the production Content Security Policy, which the test fixture holds every
// page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, completeAnswers, draft, sent, stubApply } from './apply-api.ts';
import type { ApplyOptions } from './apply-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { stubMonitoring } from './monitoring-api.ts';

const home = `/northfield/applications/${APPLICATION_ID}`;
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const MORE_TIME = '2026-12-15T17:00';

interface State {
  name: string;
  options: (monitoring: ReturnType<typeof stubMonitoring>) => ApplyOptions;
  open: (page: Page) => Promise<void>;
}

const assisted = sent({ id: APPLICATION_ID, submissionRoute: 'assisted' });
const answered = (monitoring: ReturnType<typeof stubMonitoring>): ApplyOptions => ({
  applications: [sent({ id: APPLICATION_ID })],
  more: monitoring.handlers,
});

const states: State[] = [
  {
    name: 'the application, with more time',
    options: () => ({ applications: [draft({ closesAt: MORE_TIME })] }),
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText(/^You have more time to apply\./)).toBeVisible();
    },
  },
  {
    name: 'check your answers, with more time',
    options: () => ({ applications: [draft({ closesAt: MORE_TIME, answers: completeAnswers })] }),
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(page.getByRole('button', { name: 'Submit application' })).toBeVisible();
    },
  },
  {
    name: 'your applications, with more time',
    options: () => ({ applications: [draft({ closesAt: MORE_TIME })] }),
    open: async (page) => {
      await page.goto('/northfield/applications');
      await expect(page.getByText('Your deadline')).toBeVisible();
    },
  },
  {
    name: 'an application the funder sent',
    options: () => ({ applications: [assisted] }),
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('The funder sent this application for you')).toBeVisible();
    },
  },
  {
    name: 'what was sent',
    options: () => ({ applications: [assisted] }),
    open: async (page) => {
      await page.goto(`${home}/sent`);
      await expect(h1(page, 'What was sent')).toBeVisible();
      await expect(page.getByText('Eastmere Community Garden').first()).toBeVisible();
    },
  },
  {
    name: 'the offer of monitoring questions',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/submitted`);
      await expect(page.getByRole('link', { name: 'Answer monitoring questions' })).toBeVisible();
    },
  },
  {
    name: 'monitoring, the explanation',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/monitoring`);
      await expect(h1(page, 'Equality monitoring')).toBeVisible();
    },
  },
  {
    name: 'monitoring, the questions',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/monitoring`);
      await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
      await expect(h1(page, 'Equality monitoring questions')).toBeVisible();
    },
  },
  {
    name: 'monitoring, sent without consent',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/monitoring`);
      await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
    },
  },
  {
    name: 'monitoring, answered',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/monitoring`);
      await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
      await page
        .getByRole('main')
        .getByRole('radio', { name: 'Prefer not to say' })
        .first()
        .check();
      await page.getByRole('checkbox', { name: /I agree to my answers/ }).check();
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await expect(h1(page, 'Your monitoring answers')).toBeVisible();
    },
  },
  {
    name: 'monitoring, withdrawn',
    options: answered,
    open: async (page) => {
      await page.goto(`${home}/monitoring`);
      await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
      await page.getByRole('checkbox', { name: /I agree to my answers/ }).check();
      await page.getByRole('button', { name: 'Send my answers' }).click();
      await page.getByRole('button', { name: 'Withdraw my answers' }).click();
      await expect(h1(page, 'Your answers are deleted')).toBeVisible();
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
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await stubApply(page, state.options(stubMonitoring(APPLICATION_ID)));
        await state.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
