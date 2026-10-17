// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every state of an application's outcome, before and after
// release, at desktop width, at 320 px wide and at 200% zoom (ADR 0006), and at
// desktop width in the dark scheme, with the API stubbed from the contracts
// (apply-api.ts). In portal-production they run under the production Content
// Security Policy, which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { SENT_APPLICATION_ID, sent, stubApply } from './apply-api.ts';
import type { ApplyOptions, Outcome } from './apply-api.ts';
import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

/** A name long enough to test that nothing runs off a 320 px screen. */
const LONG_NAME = `${'Eastmere'.repeat(9)} Community Garden and Allotment Association`;

const home = `/northfield/applications/${SENT_APPLICATION_ID}`;

const award: Outcome = { result: 'accepted', amount: { amountMinor: 1_250_000, currency: 'GBP' } };
const awarded = sent({ status: 'awarded', outcome: award });
const waitlisted = sent({ status: 'waitlisted', outcome: { result: 'waitlisted' } });
const declined = sent({ status: 'not_funded', outcome: { result: 'declined' } });

/** The first screen of a test can take a while to build on a busy machine; the rest are quick. */
const slowly = expect.configure({ timeout: 20_000 });

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

interface State {
  name: string;
  options: ApplyOptions;
  /** Opens the screen and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

/** Opens an address and waits for its heading. */
const show =
  (path: string, heading: string): State['open'] =>
  async (page) => {
    await page.goto(path);
    await slowly(h1(page, heading)).toBeVisible();
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
  };

const states: State[] = [
  {
    name: 'an award',
    options: { applications: [awarded] },
    open: show(`${home}/outcome`, 'Your application was successful'),
  },
  {
    name: 'an award to an organisation with a long name',
    options: { applications: [awarded], organisationName: LONG_NAME },
    open: show(`${home}/outcome`, 'Your application was successful'),
  },
  {
    name: 'a place on the waiting list',
    options: { applications: [waitlisted] },
    open: show(`${home}/outcome`, 'You are on our waiting list'),
  },
  {
    name: 'a decision not to fund',
    options: { applications: [declined] },
    open: show(`${home}/outcome`, 'We could not fund your application'),
  },
  {
    name: 'the outcome page of an application under review',
    options: { applications: [sent({ status: 'under_review' })] },
    open: show(`${home}/outcome`, 'Your application'),
  },
  {
    name: 'the outcome page of an application that was submitted',
    options: { applications: [sent({ status: 'submitted' })], organisationName: LONG_NAME },
    open: show(`${home}/outcome`, 'Your application'),
  },
  {
    name: 'an outcome that is loading',
    options: { applications: [awarded] },
    open: async (page) => {
      await page.route(
        (url) => url.pathname === `/api/portal/applications/${SENT_APPLICATION_ID}`,
        () => undefined,
      );
      await page.goto(`${home}/outcome`);
      await slowly(h1(page, 'Your application')).toBeVisible();
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading…');
    },
  },
  {
    name: 'an outcome that cannot be found',
    options: {
      applications: [awarded],
      more: { [`GET /portal/applications/${SENT_APPLICATION_ID}`]: problem(404, 'Not found.') },
    },
    open: async (page) => {
      await page.goto(`${home}/outcome`);
      await slowly(
        page.getByText('We cannot find this application. It may belong to someone else.'),
      ).toBeVisible();
    },
  },
  {
    name: 'an outcome that could not be loaded',
    options: {
      applications: [awarded],
      more: {
        [`GET /portal/applications/${SENT_APPLICATION_ID}`]: problem(
          503,
          'The service is busy. Try again in a minute.',
        ),
      },
    },
    open: async (page) => {
      await page.goto(`${home}/outcome`);
      await slowly(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'your applications, with an award, a waiting list place, a decision not to fund and one under review',
    options: {
      applications: [
        awarded,
        { ...waitlisted, id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' },
        { ...declined, id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' },
        { ...sent({ status: 'under_review' }), id: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f' },
      ],
      organisationName: LONG_NAME,
    },
    open: show('/northfield/applications', 'Your applications'),
  },
  {
    name: 'the application, with its outcome released',
    options: { applications: [awarded], organisationName: LONG_NAME },
    open: async (page) => {
      await page.goto(home);
      await slowly(page.getByRole('link', { name: 'Read your outcome' })).toBeVisible();
    },
  },
  {
    name: 'the application, under review',
    options: { applications: [sent({ status: 'under_review' })] },
    open: async (page) => {
      await page.goto(home);
      await slowly(page.getByText(/^Status/)).toBeVisible();
    },
  },
  {
    name: 'the status page, with its outcome released',
    options: { applications: [waitlisted] },
    open: async (page) => {
      await page.goto(`${home}/submitted`);
      await slowly(page.getByRole('link', { name: 'Read your outcome' })).toBeVisible();
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
        await stubApply(page, state.options);
        await state.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
