// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every profile and organisation screen and state, at desktop
// width, at 320 px wide and at 200% zoom (ADR 0006), and at desktop width in
// the dark scheme, in the funder's standard look and in a saved custom look,
// with the API stubbed from the contracts (profile-api.ts). In
// portal-production they run under the production Content Security Policy,
// which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { custom, problem, standard } from './auth-api.ts';
import type { Handler, SessionOptions } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { garden, newApplicant, settledApplicant, stubApplicant } from './profile-api.ts';
import type { Applicant } from './profile-api.ts';

/** An address long enough to test that nothing runs off a 320 px screen. */
const LONG_EMAIL =
  'a.very.long.name.for.an.applicant.at.a.charity@example-charity-organisation.org.uk';
const LONG_NAME = `${'Eastmere'.repeat(9)} Community Garden and Allotment Association`;

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const refused = 'Some fields are not valid. Fix the fields listed and try again.';
const unavailable = problem(503, 'The service is busy. Try again in a minute.');

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

interface State {
  name: string;
  applicant?: Applicant;
  more?: Record<string, Handler>;
  session?: SessionOptions;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'start page with nothing done yet',
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(page.getByText('Not started', { exact: true })).toHaveCount(3);
    },
  },
  {
    name: 'start page with everything done and a notice',
    applicant: settledApplicant(),
    open: async (page) => {
      await page.goto('/northfield/?saved=details');
      await expect(page.getByText('Your details are saved.')).toBeVisible();
      await expect(page.getByText('Completed', { exact: true })).toHaveCount(3);
    },
  },
  {
    name: 'start page when progress cannot be read',
    more: { 'GET /portal/profile': unavailable },
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(page.getByText('We could not check how far you have got.')).toBeVisible();
    },
  },
  {
    name: 'your details',
    open: async (page) => {
      await page.goto('/northfield/profile');
      await expect(page.getByRole('textbox', { name: 'First name' })).toBeVisible();
    },
  },
  {
    name: 'your details, saved, with a long email address',
    applicant: settledApplicant(),
    session: { email: LONG_EMAIL },
    open: async (page) => {
      await page.goto('/northfield/profile');
      await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Ada');
      await expect(page.getByText(LONG_EMAIL, { exact: true }).last()).toBeVisible();
    },
  },
  {
    name: 'your details while loading',
    open: async (page) => {
      await neverAnswer(page, '/api/portal/profile');
      await page.goto('/northfield/profile');
      await expect(h1(page, 'Your details')).toBeVisible();
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading…');
    },
  },
  {
    name: 'your details that could not be loaded',
    more: { 'GET /portal/profile': unavailable },
    open: async (page) => {
      await page.goto('/northfield/profile');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'your details with a problem for each name',
    open: async (page) => {
      await page.goto('/northfield/profile');
      await page.getByRole('button', { name: 'Save details' }).click();
      await expect(summary(page).getByRole('link')).toHaveCount(2);
    },
  },
  {
    name: 'your details with the API refusing a name',
    more: {
      'PUT /portal/profile': problem(400, refused, [
        { field: 'body.givenName', message: 'Remove line breaks and hidden characters.' },
      ]),
    },
    open: async (page) => {
      await page.goto('/northfield/profile');
      await page.getByRole('textbox', { name: 'First name' }).fill('Ada');
      await page.getByRole('textbox', { name: 'Last name' }).fill('Lovelace');
      await page.getByRole('button', { name: 'Save details' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'your details with what was typed put back',
    open: async (page) => {
      await page.goto('/northfield/profile');
      await page.getByRole('textbox', { name: 'First name' }).fill('Augusta');
      await page.getByRole('link', { name: 'Apply for a grant' }).click();
      await page.getByRole('link', { name: 'Your details' }).click();
      await expect(page.getByText('We kept what you typed last time.')).toBeVisible();
    },
  },
  {
    name: 'your organisations, with none',
    open: async (page) => {
      await page.goto('/northfield/organisations');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No organisations yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'your organisations, with one and a notice',
    applicant: settledApplicant(),
    open: async (page) => {
      await page.goto('/northfield/organisations?saved=organisation-added');
      await expect(page.getByText('Your organisation is added.')).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 2, name: 'Eastmere Community Garden' }),
      ).toBeVisible();
    },
  },
  {
    name: 'your organisations, with a very long name',
    applicant: { ...settledApplicant(), organisations: [{ ...garden, name: LONG_NAME }] },
    open: async (page) => {
      await page.goto('/northfield/organisations');
      await expect(page.getByRole('heading', { level: 2, name: LONG_NAME })).toBeVisible();
    },
  },
  {
    name: 'add your organisation',
    open: async (page) => {
      await page.goto('/northfield/organisations/new');
      await expect(page.getByRole('textbox', { name: 'Organisation name' })).toBeVisible();
    },
  },
  {
    name: 'add your organisation with every kind of number',
    open: async (page) => {
      await page.goto('/northfield/organisations/new');
      for (let count = 0; count < 5; count += 1) {
        await page
          .getByRole('button', { name: /^Add (a charity or company|another) number$/ })
          .click();
      }
      await expect(page.getByRole('group', { name: 'Number 5' })).toBeVisible();
    },
  },
  {
    name: 'add your organisation with a problem in each place',
    open: async (page) => {
      await page.goto('/northfield/organisations/new');
      await page.getByRole('button', { name: 'Add a charity or company number' }).click();
      await page.getByRole('textbox', { name: 'Postcode' }).fill('nowhere');
      await page.getByRole('textbox', { name: 'Website (optional)' }).fill('http://example.org');
      await page.getByRole('button', { name: 'Add organisation' }).click();
      await expect(summary(page)).toBeFocused();
      await expect(summary(page).getByRole('link')).toHaveCount(7);
    },
  },
  {
    name: 'add your organisation with the API refusing the postcode',
    more: {
      'POST /portal/organisations': problem(400, refused, [
        { field: 'body.registeredAddress.postcode', message: 'Enter the postcode or zip code.' },
      ]),
    },
    open: async (page) => {
      await page.goto('/northfield/organisations/new');
      await page.getByRole('textbox', { name: 'Organisation name' }).fill('Eastmere Youth Club');
      await page
        .getByRole('combobox', { name: 'Type of organisation' })
        .selectOption('unincorporated_group');
      await page.getByRole('textbox', { name: 'Address line 1' }).fill('1 High Street');
      await page.getByRole('textbox', { name: 'Town or city' }).fill('Eastmere');
      await page.getByRole('textbox', { name: 'Postcode' }).fill('EA1 1AA');
      await page.getByRole('button', { name: 'Add organisation' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'change organisation details',
    applicant: settledApplicant(),
    open: async (page) => {
      await page.goto(`/northfield/organisations/${garden.id}`);
      await expect(page.getByRole('textbox', { name: 'Organisation name' })).toHaveValue(
        'Eastmere Community Garden',
      );
      await expect(page.getByRole('group', { name: 'Number 1' })).toBeVisible();
    },
  },
  {
    name: 'an organisation that cannot be found',
    more: { [`GET /portal/organisations/${garden.id}`]: problem(404, 'Not found.') },
    open: async (page) => {
      await page.goto(`/northfield/organisations/${garden.id}`);
      await expect(
        page.getByText('We cannot find this organisation. It may belong to someone else.'),
      ).toBeVisible();
    },
  },
  {
    name: 'future funding with no choice yet',
    open: async (page) => {
      await page.goto('/northfield/future-funding');
      await expect(page.getByText('You have not chosen yet.')).toBeVisible();
    },
  },
  {
    name: 'future funding with a choice made',
    applicant: settledApplicant(),
    open: async (page) => {
      await page.goto('/northfield/future-funding');
      await expect(
        page.getByRole('radio', { name: 'Yes, email me about future funding' }),
      ).toBeChecked();
    },
  },
  {
    name: 'future funding with nothing chosen',
    open: async (page) => {
      await page.goto('/northfield/future-funding');
      await page.getByRole('button', { name: 'Save my choice' }).click();
      await expect(summary(page).getByRole('link', { name: 'Choose yes or no.' })).toBeVisible();
    },
  },
  {
    name: 'a funder that does not exist',
    more: { 'GET /public/tenants/northfield': problem(404, 'Not found.') },
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(h1(page, 'We cannot find this funder')).toBeVisible();
    },
  },
];

const looks = [
  { name: 'the standard look', funder: standard },
  { name: 'a saved custom look', funder: custom },
] as const;

for (const look of looks) {
  for (const variant of variants) {
    test.describe(`in ${look.name} at ${variant.name}`, () => {
      test.use({
        viewport: variant.viewport,
        deviceScaleFactor: variant.deviceScaleFactor,
        colorScheme: variant.scheme,
      });
      // Axe reads a whole page, and a slow browser on a busy machine needs time to do it.
      test.describe.configure({ timeout: 90_000 });

      for (const state of states) {
        test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
          await stubApplicant(page, state.applicant, state.more, look.funder, state.session);
          await state.open(page);

          await expectNoViolations(page);
          await expectNoHorizontalScroll(page);
        });
      }

      test('@a11y the organisation form has no axe violations while its controls have focus', async ({
        page,
      }) => {
        await stubApplicant(page, newApplicant(), {}, look.funder);
        await page.goto('/northfield/organisations/new');
        await expect(h1(page, 'Add your organisation')).toBeVisible();
        await page.getByRole('button', { name: 'Add a charity or company number' }).click();

        for (const control of [
          page.getByRole('textbox', { name: 'Organisation name' }),
          page.getByRole('combobox', { name: 'Type of organisation' }),
          page.getByRole('combobox', { name: 'Type of number' }),
          page.getByRole('button', { name: 'Remove number 1' }),
          page.getByRole('button', { name: 'Add another number' }),
          page.getByRole('combobox', { name: 'Country' }),
          page.getByRole('button', { name: 'Add organisation' }),
        ]) {
          await control.focus();
          await expect(control).toBeFocused();
          await expectNoViolations(page);
        }
      });
    });
  }
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('@a11y the organisation form has no axe violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await stubApplicant(page);
    await page.goto('/northfield/organisations/new');
    await expect(h1(page, 'Add your organisation')).toBeVisible();

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
