// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 7: an applicant opens /northfield on the portal, signs up with an
// email address, sets a password, completes their details and organisation
// (charity number GB-CHC-…), and chooses whether to hear about future funding.

import type { Page } from '@playwright/test';

import { signInApplicant } from '../support/api.ts';
import { addressFor, APPLICANT_PASSWORD, registerPerson } from '../support/applicants.ts';
import { axePages } from '../support/axe.ts';
import { openEmailedLink } from '../support/mail.ts';
import { updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const tasks = (page: Page) => page.getByRole('list', { name: 'Get ready to apply' });

test.describe('step 7: an applicant signs up and gets ready to apply', () => {
  test('signs up by email, completes their details and organisation, and chooses about future funding', async ({
    pages,
  }) => {
    const email = addressFor('applicant1');
    const visitor = await pages.visitor();
    await visitor.goto('/northfield/');
    await visitor.getByRole('link', { name: 'Create an account' }).click();
    await visitor.getByRole('textbox', { name: 'Email address' }).fill(email);
    await visitor.getByRole('button', { name: 'Email me a link' }).click();
    await expect(h1(visitor, 'Check your email')).toBeVisible();
    await openEmailedLink(visitor, email, '/sign-up/complete');
    await visitor.getByLabel('Password', { exact: true }).fill(APPLICANT_PASSWORD);
    await visitor.getByRole('button', { name: 'Create account' }).click();
    await expect(h1(visitor, 'Sign in')).toBeVisible();
    registerPerson('applicant1', email);

    const page = await pages.applicant('applicant1');
    await expect(tasks(page).getByText('Not started')).toHaveCount(3);

    await tasks(page).getByRole('link', { name: 'Your details' }).click();
    await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'First name' }).fill('Sam');
    await page.getByRole('textbox', { name: 'Last name' }).fill('Eastmere');
    await page.getByRole('textbox', { name: 'Phone number (optional)' }).fill('01632 960 001');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Your details are saved.')).toBeVisible();

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

    await page.getByRole('link', { name: 'Apply for a grant' }).click();
    await tasks(page).getByRole('link', { name: 'Future funding' }).click();
    await page.getByRole('radio', { name: 'Yes, email me about future funding' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();
    await expect(page.getByText('Your choice is saved.')).toBeVisible();
    await expect(tasks(page).getByText('Completed')).toHaveCount(3);
  });

  test('the API holds the organisation under GB-CHC and the choice as a consent', async () => {
    const api = await signInApplicant('northfield', 'applicant1');
    const { organisations } = await api.ok<{ organisations: { id: string }[] }>(
      'GET',
      '/portal/organisations',
    );
    expect(organisations).toHaveLength(1);
    const organisationId = organisations[0]?.id ?? '';
    const organisation = await api.ok<{ identifiers: { scheme: string; identifier: string }[] }>(
      'GET',
      `/portal/organisations/${organisationId}`,
    );
    expect(organisation.identifiers).toContainEqual({ scheme: 'GB-CHC', identifier: '1187654' });
    const profile = await api.ok<{ consents: { purpose: string; state: string }[] }>(
      'GET',
      '/portal/profile',
    );
    expect(profile.consents).toContainEqual(
      expect.objectContaining({ purpose: 'future_funding', state: 'given' }),
    );
    updateState((state) => {
      state.ids['applicant1OrganisationId'] = organisationId;
    });
    await api.dispose();
  });

  test('@a11y the get-ready pages have no axe violations', async ({ pages }) => {
    await axePages(await pages.applicant('applicant1'), [
      '/northfield/',
      '/northfield/profile',
      '/northfield/organisations',
      '/northfield/future-funding',
    ]);
  });
});
