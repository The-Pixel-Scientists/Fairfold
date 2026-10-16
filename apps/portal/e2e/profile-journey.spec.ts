// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 7 against the real API: a new applicant completes their profile,
// adds an organisation with a charity number, and chooses whether to hear
// about future funding, and finds it all again after signing in afresh. It
// needs the stack: `pnpm stack`, then `pnpm test:stack -- profile`.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { createAccount, signIn } from './mailpit.ts';

const PASSWORD = 'a long passphrase for the demo';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const tasks = (page: Page) => page.getByRole('list', { name: 'Get ready to apply' });

test.describe('an applicant getting ready, against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- profile.',
  );
  test.setTimeout(240_000);

  test('@api completes their profile, adds an organisation with a charity number and chooses about future funding', async ({
    page,
  }) => {
    const address = `applicant-${String(Date.now())}@example.org`;
    await createAccount(page, address, PASSWORD);
    await signIn(page, address, PASSWORD);
    await expect(h1(page, 'Apply for a grant')).toBeVisible();
    await expect(tasks(page).getByText('Not started')).toHaveCount(3);

    // Their details. The email is the sign-in address, shown and not editable.
    await tasks(page).getByRole('link', { name: 'Your details' }).click();
    await expect(h1(page, 'Your details')).toBeVisible();
    await expect(page.getByRole('main').getByText(address, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await page.getByRole('textbox', { name: 'Last name' }).fill('Lovelace');
    await page.getByRole('textbox', { name: 'Phone number (optional)' }).fill('01632 960 001');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Your details are saved.')).toBeVisible();

    // Their organisation, with a charity number the API stores as GB-CHC.
    await tasks(page).getByRole('link', { name: 'Your organisations' }).click();
    await page.getByRole('link', { name: 'Add your organisation' }).click();
    await page
      .getByRole('textbox', { name: 'Organisation name' })
      .fill('Eastmere Community Garden');
    await page
      .getByRole('combobox', { name: 'Type of organisation' })
      .selectOption({ label: 'Registered charity' });
    await page.getByRole('button', { name: 'Add a charity or company number' }).click();
    await expect(page.getByRole('combobox', { name: 'Type of number' })).toHaveValue('GB-CHC');
    await page.getByRole('textbox', { name: 'Number', exact: true }).fill('1187654');
    await page.getByRole('textbox', { name: 'Address line 1' }).fill('12 Mill Lane');
    await page.getByRole('textbox', { name: 'Town or city' }).fill('Eastmere');
    await page.getByRole('textbox', { name: 'Postcode' }).fill('ea1 2st');
    await page.getByRole('button', { name: 'Add organisation' }).click();
    await expect(page.getByText('Your organisation is added.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Eastmere Community Garden' }),
    ).toBeVisible();

    // Their choice about future funding.
    await page.getByRole('link', { name: 'Apply for a grant' }).click();
    await tasks(page).getByRole('link', { name: 'Future funding' }).click();
    await page.getByRole('radio', { name: 'Yes, email me about future funding' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();
    await expect(page.getByText('Your choice is saved.')).toBeVisible();
    await expect(tasks(page).getByText('Completed')).toHaveCount(3);

    // Signing in afresh, everything is still there.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(h1(page, 'You have signed out')).toBeVisible();
    await signIn(page, address, PASSWORD);
    await expect(tasks(page).getByText('Completed')).toHaveCount(3);
    await tasks(page).getByRole('link', { name: 'Your details' }).click();
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Ada');
    await expect(page.getByRole('textbox', { name: 'Phone number (optional)' })).toHaveValue(
      '01632 960 001',
    );
    await page.getByRole('link', { name: 'Apply for a grant' }).click();
    await tasks(page).getByRole('link', { name: 'Your organisations' }).click();
    await page.getByRole('link', { name: 'Change details for Eastmere Community Garden' }).click();
    await expect(page.getByRole('textbox', { name: 'Number', exact: true })).toHaveValue('1187654');
    await expect(page.getByRole('combobox', { name: 'Type of number' })).toHaveValue('GB-CHC');
    await expect(page.getByRole('textbox', { name: 'Postcode' })).toHaveValue('EA1 2ST');
    await page.getByRole('link', { name: 'Apply for a grant' }).click();
    await tasks(page).getByRole('link', { name: 'Future funding' }).click();
    await expect(
      page.getByRole('radio', { name: 'Yes, email me about future funding' }),
    ).toBeChecked();
  });
});
