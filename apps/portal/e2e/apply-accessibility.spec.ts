// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every apply screen and state, at desktop width, at 320 px wide
// and at 200% zoom (ADR 0006), and at desktop width in the dark scheme, with the
// API stubbed from the contracts (apply-api.ts). In portal-production they run
// under the production Content Security Policy, which the test fixture holds
// every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  APPLICATION_ID,
  ROUND_ID,
  SENT_APPLICATION_ID,
  completeAnswers,
  draft,
  sent,
  stubApply,
} from './apply-api.ts';
import type { ApplyOptions } from './apply-api.ts';
import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

/** A name long enough to test that nothing runs off a 320 px screen. */
const LONG_NAME = `${'Eastmere'.repeat(9)} Community Garden and Allotment Association`;

const home = `/northfield/applications/${APPLICATION_ID}`;
const eligible = { f_charity: true };
const unavailable = problem(503, 'The service is busy. Try again in a minute.');

/** The first screen of a test can take a while to build on a busy machine; the rest are quick. */
const slowly = expect.configure({ timeout: 20_000 });

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

interface State {
  name: string;
  options?: ApplyOptions;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: Awaited<ReturnType<typeof stubApply>>) => Promise<void>;
}

/** Opens an address and waits for its heading. */
const show =
  (path: string, heading: string): State['open'] =>
  async (page) => {
    await page.goto(path);
    await expect(h1(page, heading)).toBeVisible();
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
  };

const states: State[] = [
  { name: 'programmes', open: show('/northfield/programmes', 'Programmes you can apply to') },
  {
    name: 'programmes, with none open',
    options: { open: false },
    open: async (page) => {
      await page.goto('/northfield/programmes');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No programmes are open at the moment' }),
      ).toBeVisible();
    },
  },
  {
    name: 'programmes that could not be loaded',
    options: { more: { 'GET /portal/rounds': unavailable } },
    open: async (page) => {
      await page.goto('/northfield/programmes');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'a round',
    open: show(`/northfield/programmes/${ROUND_ID}`, 'Community Spaces Fund'),
  },
  {
    name: 'a round that is not open',
    options: { open: false },
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ROUND_ID}`);
      await expect(page.getByText(/^This programme is not taking applications\./)).toBeVisible();
    },
  },
  {
    name: 'a round that is loading',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === `/api/portal/rounds/${ROUND_ID}`,
        () => undefined,
      );
      await page.goto(`/northfield/programmes/${ROUND_ID}`);
      await expect(h1(page, 'Programme')).toBeVisible();
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading…');
    },
  },
  {
    name: 'who is applying',
    options: { organisationName: LONG_NAME },
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ROUND_ID}/start`);
      await expect(page.getByRole('radio', { name: /Eastmere/ })).toBeChecked();
    },
  },
  {
    name: 'who is applying, with no organisation',
    options: { organisations: false },
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ROUND_ID}/start`);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Add your organisation first' }),
      ).toBeVisible();
    },
  },
  {
    name: 'who is applying, with a problem',
    options: {
      more: {
        'GET /portal/organisations': {
          status: 200,
          body: {
            organisations: [
              {
                id: '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55',
                name: 'Eastmere Garden',
                legalForm: 'registered_charity',
              },
              {
                id: '7d2e9a64-1b3c-4d5e-8f6a-0b1c2d3e4f5a',
                name: 'Eastmere Youth Club',
                legalForm: 'unincorporated_group',
              },
            ],
          },
        },
      },
    },
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ROUND_ID}/start`);
      await page.getByRole('button', { name: 'Start application' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'who is applying, with an application already started',
    options: {
      applications: [draft()],
    },
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ROUND_ID}/start`);
      await page.getByRole('button', { name: 'Start application' }).click();
      await expect(summary(page)).toContainText(
        'This organisation has already started an application for this round.',
      );
    },
  },
  {
    name: 'your applications',
    options: {
      applications: [draft({ answers: eligible }), sent()],
      organisationName: LONG_NAME,
    },
    open: show('/northfield/applications', 'Your applications'),
  },
  {
    name: 'your applications, with none',
    open: async (page) => {
      await page.goto('/northfield/applications');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You have not started an application' }),
      ).toBeVisible();
    },
  },
  {
    name: 'withdrawing an application',
    options: { applications: [sent()] },
    open: async (page) => {
      await page.goto('/northfield/applications');
      await page
        .getByRole('button', {
          name: 'Withdraw application for Community Spaces Fund, Spring 2027',
        })
        .click();
      await expect(page.getByRole('dialog', { name: 'Withdraw this application?' })).toBeVisible();
    },
  },
  {
    name: 'a withdrawn application',
    options: { applications: [sent({ status: 'withdrawn' })] },
    open: async (page) => {
      await page.goto('/northfield/applications');
      await expect(page.getByText('You withdrew this application.')).toBeVisible();
    },
  },
  {
    name: 'the application, just started',
    options: { applications: [draft()], organisationName: LONG_NAME },
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('Cannot start yet')).toHaveCount(3);
    },
  },
  {
    name: 'the application, part way',
    options: { applications: [draft({ answers: { ...eligible, f_name: 'Eastmere' } })] },
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('In progress', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'the application, complete',
    options: { applications: [draft({ answers: completeAnswers })] },
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('Completed', { exact: true })).toHaveCount(4);
    },
  },
  {
    name: 'the application, not allowed to apply',
    options: { applications: [draft({ answers: { f_charity: false } })] },
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('You cannot apply with your answers.').first()).toBeVisible();
    },
  },
  {
    name: 'an application that cannot be found',
    options: {
      more: { [`GET /portal/applications/${APPLICATION_ID}`]: problem(404, 'Not found.') },
    },
    open: async (page) => {
      await page.goto(home);
      await expect(
        page.getByText('We cannot find this application. It may belong to someone else.'),
      ).toBeVisible();
    },
  },
  {
    name: 'an application that is loading',
    options: { applications: [draft()] },
    open: async (page) => {
      await page.route(
        (url) => url.pathname === `/api/portal/applications/${APPLICATION_ID}`,
        () => undefined,
      );
      await page.goto(home);
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading…');
    },
  },
  {
    name: 'an application that has been sent, opened to change',
    options: { applications: [sent({ id: APPLICATION_ID })] },
    open: show(`${home}/sections/s_about`, 'Your application'),
  },
  {
    name: 'the eligibility question',
    options: { applications: [draft()] },
    open: async (page) => {
      await page.goto(`${home}/eligibility`);
      await expect(page.getByRole('radio', { name: 'Yes' })).toBeVisible();
    },
  },
  {
    name: 'the eligibility question, answered no',
    options: { applications: [draft({ answers: { f_charity: false } })] },
    open: async (page) => {
      await page.goto(`${home}/eligibility`);
      await expect(page.getByRole('alert')).toContainText('You cannot apply with this answer');
    },
  },
  {
    name: 'the eligibility question, with nothing chosen',
    options: { applications: [draft()] },
    open: async (page) => {
      await page.goto(`${home}/eligibility`);
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a section',
    options: { applications: [draft({ answers: eligible })] },
    open: async (page) => {
      await page.goto(`${home}/sections/s_about`);
      await expect(page.getByRole('textbox', { name: /^Organisation name/ })).toBeVisible();
    },
  },
  {
    name: 'a section with a question that depends on an answer, and a long answer',
    options: {
      applications: [
        draft({
          answers: {
            ...eligible,
            f_name: LONG_NAME,
            f_haveweb: true,
            f_web: `https://${'a-long-address'.repeat(8)}.example.org`,
          },
        }),
      ],
    },
    open: async (page) => {
      await page.goto(`${home}/sections/s_about`);
      await expect(page.getByRole('textbox', { name: /^Website address/ })).toBeVisible();
    },
  },
  {
    name: 'a section with a problem in each place',
    options: { applications: [draft({ answers: eligible })] },
    open: async (page) => {
      await page.goto(`${home}/sections/s_about`);
      await page.getByRole('textbox', { name: /^Contact email address/ }).fill('ada@');
      await expect(
        page.getByText('Some answers are not saved yet. Fix them to save them.'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a section with an answer over its limit',
    options: { applications: [draft({ answers: eligible })] },
    open: async (page) => {
      await page.goto(`${home}/sections/s_project`);
      await page.getByRole('textbox', { name: /^Project summary/ }).fill('word '.repeat(53));
      await expect(page.getByText('You have 3 words too many').first()).toBeVisible();
    },
  },
  {
    name: 'a budget table with rows and a total',
    options: {
      applications: [
        draft({
          answers: {
            ...eligible,
            f_costs: [
              { c_item: 'Hall hire', c_cost: { amountMinor: 288_000, currency: 'GBP' } },
              { c_item: LONG_NAME, c_cost: { amountMinor: 120_050, currency: 'GBP' } },
            ],
          },
        }),
      ],
    },
    open: async (page) => {
      await page.goto(`${home}/sections/s_budget`);
      await expect(page.getByText('£4,080.50').first()).toBeVisible();
    },
  },
  {
    name: 'a section when a save failed',
    options: { applications: [draft({ answers: eligible })] },
    open: async (page, stub) => {
      stub.failSaves(1000);
      await page.goto(`${home}/sections/s_about`);
      await page.getByRole('textbox', { name: /^Organisation name/ }).fill('Eastmere');
      await expect(page.getByText('Not saved. Check your connection and try again')).toBeVisible();
    },
  },
  {
    name: 'a section when the answers were saved somewhere else',
    options: { applications: [draft({ answers: eligible })] },
    open: async (page, stub) => {
      await page.goto(`${home}/sections/s_about`);
      await expect(h1(page, 'About your organisation')).toBeVisible();
      const [application] = stub.applications;
      if (application !== undefined) application.answersVersion = 4;
      await page.getByRole('textbox', { name: /^Organisation name/ }).fill('Eastmere');
      await expect(page.getByText('Your answers were saved somewhere else')).toBeVisible();
    },
  },
  {
    name: 'a section that waits for eligibility',
    options: { applications: [draft()] },
    open: async (page) => {
      await page.goto(`${home}/sections/s_project`);
      await expect(
        page.getByText('Check you can apply before you start this section.'),
      ).toBeVisible();
    },
  },
  {
    name: 'a section that is not in the application',
    options: { applications: [draft({ answers: eligible })] },
    open: show(`${home}/sections/s_nothing`, 'We cannot find this section'),
  },
  {
    name: 'check your answers, with things to fix',
    options: { applications: [draft({ answers: { ...eligible, f_name: 'Eastmere' } })] },
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(
        page.getByRole('region', { name: 'Before you can send your application' }),
      ).toBeVisible();
    },
  },
  {
    name: 'check your answers, not allowed to apply',
    options: { applications: [draft({ answers: { f_charity: false } })] },
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(page.getByText(/^Check you can apply: /)).toBeVisible();
    },
  },
  {
    name: 'check your answers, ready to submit',
    options: { applications: [draft({ answers: completeAnswers })] },
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(page.getByRole('button', { name: 'Submit application' })).toBeVisible();
    },
  },
  {
    name: 'check your answers, with the API refusing the application',
    options: {
      applications: [draft({ answers: completeAnswers })],
      more: {
        [`POST /portal/applications/${APPLICATION_ID}/submit`]: problem(
          422,
          'This round closed on 2 November 2026.',
        ),
      },
    },
    open: async (page) => {
      await page.goto(`${home}/check`);
      await page.getByRole('button', { name: 'Submit application' }).click();
      await expect(page.getByRole('alert')).toContainText('This round closed on 2 November 2026.');
    },
  },
  {
    name: 'application submitted',
    options: { applications: [sent({ id: APPLICATION_ID })], organisationName: LONG_NAME },
    open: show(`${home}/submitted`, 'Application submitted'),
  },
  {
    name: 'an application that is not sent yet, opened to see what happens next',
    options: { applications: [draft()] },
    open: async (page) => {
      await page.goto(`${home}/submitted`);
      await expect(page.getByText('You have not sent this application yet.')).toBeVisible();
    },
  },
  {
    name: 'an application that was withdrawn',
    options: { applications: [sent({ id: SENT_APPLICATION_ID, status: 'withdrawn' })] },
    open: async (page) => {
      await page.goto(`/northfield/applications/${SENT_APPLICATION_ID}/submitted`);
      await expect(page.getByText(/: Withdrawn\.$/)).toBeVisible();
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
    // Axe reads a whole page, and a slow browser on a busy machine needs time to do it.
    // Each check opens its own page and its own stub, so they run side by side.
    test.describe.configure({ mode: 'parallel', timeout: 90_000 });

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        const stub = await stubApply(page, state.options);
        await state.open(page, stub);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test.describe.configure({ timeout: 90_000 });

  test('@a11y a section has no axe violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await stubApply(page, { applications: [draft({ answers: eligible })] });
    await page.goto(`${home}/sections/s_about`);
    await slowly(h1(page, 'About your organisation')).toBeVisible();

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('while a control has focus', () => {
  test.describe.configure({ timeout: 90_000 });

  test('@a11y the controls of a section have no axe violations', async ({ page }) => {
    await stubApply(page, { applications: [draft({ answers: eligible })] });
    await page.goto(`${home}/sections/s_budget`);
    await slowly(h1(page, 'Budget')).toBeVisible();
    await page.getByRole('button', { name: 'Add the first cost' }).click();

    for (const control of [
      page.getByRole('textbox', { name: /^Item/ }),
      page.getByRole('textbox', { name: /^Cost/ }),
      page.getByRole('button', { name: 'Remove cost 1' }),
      page.getByRole('button', { name: 'Add another cost' }),
      page.getByRole('button', { name: 'Save and check your answers' }),
      page.getByRole('button', { name: 'Save and come back later' }),
    ]) {
      await control.focus();
      await expect(control).toBeFocused();
      await expectNoViolations(page);
    }
  });
});
