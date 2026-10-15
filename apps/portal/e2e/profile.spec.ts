// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's look, and an applicant's details, organisations and choice
// about future funding, in a real browser, with the API's answers stubbed
// from the contracts (profile-api.ts). The same journey runs against the
// real API in profile-journey.spec.ts.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, custom, problem, signedOut, stubApi } from './auth-api.ts';
import { newApplicant, settledApplicant, stubApplicant } from './profile-api.ts';

const SUFFIX = '– Fairfold Grants';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const tasks = (page: Page) => page.getByRole('list', { name: 'Get ready to apply' });

test.describe("the funder's look", () => {
  test.use({ colorScheme: 'light' });

  test('shows the funder’s logo and brand colour on every page, and the name on the start page', async ({
    page,
  }) => {
    await stubApi(page, { 'GET /auth/session': signedOut }, custom);

    await page.goto('/northfield/');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    const logo = page.getByRole('banner').getByRole('img', { name: 'Northfield Foundation' });
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'rounded');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
        ),
      )
      .toBe(custom.brandColour);
    await expect(page.getByText(/which grants Northfield Foundation has open/)).toBeVisible();

    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('img', { name: 'Northfield Foundation' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'rounded');
  });

  test('shows the funder’s name in the header when it has no logo', async ({ page }) => {
    await stubApi(page, { 'GET /auth/session': signedOut });

    await page.goto('/northfield/');

    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(page.getByRole('banner').getByText('Northfield Foundation')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('img')).toHaveCount(0);
  });

  test('says it cannot find a funder that does not exist, moves focus there, and offers nothing else', async ({
    page,
  }) => {
    await stubApi(page, {
      'GET /auth/session': signedOut,
      'GET /public/tenants/northfield': problem(404, 'Not found.'),
    });

    await page.goto('/northfield/');

    await expect(h1(page, 'We cannot find this funder')).toBeFocused();
    await expect(page).toHaveTitle(`We cannot find this funder ${SUFFIX}`);
    await expect(page.getByText('Check the link you were given.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
  });
});

test.describe('an applicant getting ready to apply', () => {
  test('adds their details, their organisation and their choice, one screen at a time', async ({
    page,
  }) => {
    const { applicant, sent } = await stubApplicant(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(tasks(page).getByText('Not started')).toHaveCount(3);

    // Their details.
    await tasks(page).getByRole('link', { name: 'Your details' }).click();
    await expect(h1(page, 'Your details')).toBeFocused();
    await expect(page).toHaveTitle(`Your details ${SUFFIX}`);
    await expect(
      page.getByRole('main').getByText('ada@example.org', { exact: true }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await page.getByRole('textbox', { name: 'Last name' }).fill('Lovelace');
    await page.getByRole('textbox', { name: 'Phone number (optional)' }).fill('01632 960 001');
    await page.getByRole('button', { name: 'Save details' }).click();

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page.getByText('Your details are saved.')).toBeVisible();
    await expect(tasks(page).getByRole('listitem').first()).toContainText('Completed');
    expect(sent.find(({ key }) => key === 'PUT /portal/profile')?.body).toEqual({
      givenName: 'Ada',
      familyName: 'Lovelace',
      phone: '01632 960 001',
    });

    // Their organisation.
    await tasks(page).getByRole('link', { name: 'Your organisations' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'No organisations yet' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Add your organisation' }).click();
    await expect(h1(page, 'Add your organisation')).toBeFocused();
    await page
      .getByRole('textbox', { name: 'Organisation name' })
      .fill('Eastmere Community Garden');
    await page
      .getByRole('combobox', { name: 'Type of organisation' })
      .selectOption({ label: 'Registered charity' });
    await page.getByRole('button', { name: 'Add a charity or company number' }).click();
    await expect(page.getByRole('combobox', { name: 'Type of number' })).toBeFocused();
    await expect(page.getByRole('combobox', { name: 'Type of number' })).toHaveValue('GB-CHC');
    await page.getByRole('textbox', { name: 'Number', exact: true }).fill('1187654');
    await page.getByRole('textbox', { name: 'Address line 1' }).fill('12 Mill Lane');
    await page.getByRole('textbox', { name: 'Town or city' }).fill('Eastmere');
    await page.getByRole('textbox', { name: 'Postcode' }).fill('ea1 2st');
    await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('GB');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    await expect(h1(page, 'Your organisations')).toBeFocused();
    await expect(page.getByText('Your organisation is added.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Eastmere Community Garden' }),
    ).toBeVisible();
    expect(sent.find(({ key }) => key === 'POST /portal/organisations')?.body).toEqual({
      name: 'Eastmere Community Garden',
      legalForm: 'registered_charity',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1187654' }],
      registeredAddress: {
        line1: '12 Mill Lane',
        line2: '',
        town: 'Eastmere',
        postcode: 'EA1 2ST',
        countryCode: 'GB',
      },
      website: '',
    });

    // Change it.
    await page.getByRole('link', { name: 'Change details for Eastmere Community Garden' }).click();
    await expect(h1(page, 'Change organisation details')).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Number', exact: true })).toHaveValue('1187654');
    await page.getByRole('textbox', { name: 'Organisation name' }).fill('Eastmere Garden Trust');
    await page
      .getByRole('textbox', { name: 'Website (optional)' })
      .fill('https://eastmere.example.org');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Your organisation details are saved.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Eastmere Garden Trust' }),
    ).toBeVisible();

    // Their choice about future funding.
    await page.getByRole('link', { name: 'Apply for a grant' }).click();
    await tasks(page).getByRole('link', { name: 'Future funding' }).click();
    await expect(h1(page, 'Future funding')).toBeFocused();
    await expect(page.getByText('You have not chosen yet.')).toBeVisible();
    await expect(page.getByText(/privacy notice version 1\.0/)).toBeVisible();
    await page.getByRole('radio', { name: 'Yes, email me about future funding' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    await expect(page.getByText('Your choice is saved.')).toBeVisible();
    await expect(tasks(page).getByText('Completed')).toHaveCount(3);
    expect(sent.find(({ key }) => key === 'POST /portal/profile/consents')?.body).toEqual({
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacyNoticeVersion: '1.0',
    });
    expect(applicant.consents).toHaveLength(1);
  });

  test('changes a choice by recording a new one', async ({ page }) => {
    const { applicant } = await stubApplicant(page, settledApplicant());
    await page.goto('/northfield/future-funding');

    await expect(
      page.getByText(/^Your choice now: yes\. You made it on 5 October 2026\.$/),
    ).toBeVisible();
    await expect(
      page.getByRole('radio', { name: 'Yes, email me about future funding' }),
    ).toBeChecked();
    await page.getByRole('radio', { name: 'No, do not email me about future funding' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();

    await expect(page.getByText('Your choice is saved.')).toBeVisible();
    expect(applicant.consents.map(({ state }) => state)).toEqual(['withdrawn']);
  });

  test('works from the keyboard alone: errors take focus, link to the field, and Enter saves', async ({
    page,
  }) => {
    const { applicant } = await stubApplicant(page);
    await page.goto('/northfield/profile');
    await expect(h1(page, 'Your details')).toBeVisible();
    const first = page.getByRole('textbox', { name: 'First name' });
    await first.focus();

    await page.keyboard.press('Enter');

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveCount(2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(first).toBeFocused();
    await page.keyboard.type('Ada');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Lovelace');
    await page.keyboard.press('Enter');

    await expect(h1(page, 'Apply for a grant')).toBeFocused();
    expect(applicant.givenName).toBe('Ada');
  });

  test('puts the API’s refusal beside the field, and keeps what was typed', async ({ page }) => {
    await stubApplicant(page, newApplicant(), {
      'PUT /portal/profile': problem(400, 'Some fields are not valid.', [
        { field: 'body.givenName', message: 'Remove line breaks and hidden characters.' },
      ]),
    });
    await page.goto('/northfield/profile');
    await page.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await page.getByRole('textbox', { name: 'Last name' }).fill('Lovelace');

    await page.getByRole('button', { name: 'Save details' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Remove line breaks and hidden characters.',
    );
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue('Lovelace');
  });

  test('refuses a bad organisation with the contract’s words, before anything is sent', async ({
    page,
  }) => {
    const { sent } = await stubApplicant(page);
    await page.goto('/northfield/organisations/new');
    await page.getByRole('button', { name: 'Add a charity or company number' }).click();
    await page.getByRole('textbox', { name: 'Number', exact: true }).fill('12');
    await page.getByRole('textbox', { name: 'Postcode' }).fill('nowhere');

    await page.getByRole('button', { name: 'Add organisation' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    for (const message of [
      'Enter the name of the organisation.',
      'Enter a charity number of 6 or 7 digits, like 1234567.',
      'Enter the first line of the address.',
      'Enter the town or city.',
      'Enter a UK postcode, like SW1A 1AA.',
    ]) {
      await expect(summary.getByRole('link', { name: message })).toBeVisible();
    }
    await summary.getByRole('link', { name: /charity number/ }).click();
    await expect(page.getByRole('textbox', { name: 'Number', exact: true })).toBeFocused();
    expect(sent.some(({ key }) => key === 'POST /portal/organisations')).toBe(false);
  });

  test('says it cannot find an organisation that is not theirs', async ({ page }) => {
    await stubApplicant(page, newApplicant(), {
      'GET /portal/organisations/3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55': problem(404, 'Not found.'),
    });

    await page.goto('/northfield/organisations/3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55');

    await expect(
      page.getByText('We cannot find this organisation. It may belong to someone else.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Go to your organisations' }).click();
    await expect(h1(page, 'Your organisations')).toBeVisible();
  });

  test('sends a visitor who is not signed in to sign in, and back to the page afterwards', async ({
    page,
  }) => {
    let session: unknown = null;
    await stubApi(page, {
      'GET /auth/session': () => (session === null ? signedOut : { status: 200, body: session }),
      'POST /auth/tenants/northfield/sign-in': () => {
        session = applicantSession();
        return { status: 200, body: session };
      },
      'GET /portal/profile': {
        status: 200,
        body: {
          givenName: null,
          familyName: null,
          email: 'ada@example.org',
          phone: null,
          consents: [],
        },
      },
    });

    await page.goto('/northfield/profile');

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?next=%2Fprofile$/);
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(h1(page, 'Your details')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/profile$/);
  });
});

test.describe('a session that ends while an applicant is typing', () => {
  // The page's clock starts at START and then runs at the speed of the real one, plus
  // whatever the spec has made it skip.
  const START = new Date('2026-10-05T09:00:00Z');
  let installedAt = 0;
  let skipped = 0;
  const inMinutes = (minutes: number) =>
    new Date(
      START.getTime() + (Date.now() - installedAt) + skipped + minutes * 60_000,
    ).toISOString();

  test.beforeEach(async ({ page }) => {
    installedAt = Date.now();
    skipped = 0;
    await page.clock.install({ time: START });
  });

  test('keeps what was typed, and puts it back after they sign in', async ({ page }) => {
    let expired = false;
    await stubApplicant(page, newApplicant(), {
      'GET /auth/session': () =>
        expired ? signedOut : { status: 200, body: applicantSession({ expiresAt: inMinutes(60) }) },
      'POST /auth/tenants/northfield/sign-in': () => {
        expired = false;
        return { status: 200, body: applicantSession({ expiresAt: inMinutes(60) }) };
      },
    });
    await page.goto('/northfield/profile');
    await page.getByRole('textbox', { name: 'First name' }).fill('Augusta');
    await page.getByRole('textbox', { name: 'Last name' }).fill('King');
    await expect(
      page.getByText('If you leave this page before you save, we keep what you typed'),
    ).toBeVisible();

    expired = true;
    await page.clock.fastForward('58:00');
    await expect(page.getByRole('dialog', { name: 'You will be signed out soon' })).toBeVisible();
    await page.clock.runFor('02:05');
    skipped = (58 * 60 + 2 * 60 + 5) * 1000;

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?next=%2Fprofile&notice=timeout$/);
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'Your details')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Augusta');
    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue('King');
    await expect(
      page.getByText('We kept what you typed last time. Check it, then save.'),
    ).toBeVisible();
  });
});
