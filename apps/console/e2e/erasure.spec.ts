// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The erasure screens in a real browser, with the API's answers stubbed
// (governance-api.ts), and their axe checks at every width. Every spec also
// fails on a Content Security Policy violation, so the screens are checked
// under the production policy in console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import {
  PARTY,
  REQUEST,
  checkStates,
  confirmItsYou,
  erased,
  failed,
  h1,
  queued,
  stubGovernance,
} from './governance-api.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const confirmation = `/northfield/settings/subject-access/people/${PARTY}/erasure`;
const statusPage = `/northfield/settings/subject-access/erasures/${REQUEST}`;
const READ = `GET /console/erasure-requests/${REQUEST}`;
const button = (page: Page) =>
  page.getByRole('button', { name: 'Erase personal data for Amara Okafor' });

async function openConfirmation(page: Page): Promise<void> {
  await page.goto(confirmation);
  await confirmItsYou(page);
  await expect(
    page.getByRole('form', { name: 'Erase personal data for Amara Okafor' }),
  ).toBeVisible();
}

test.describe('erasure', () => {
  test('asks it is them first, names the person and blocks the button until chosen', async ({
    page,
  }) => {
    await stubGovernance(page);
    await openConfirmation(page);

    await expect(page.getByText('What happens when you erase Amara Okafor')).toBeVisible();
    await expect(page.getByText('It cannot be undone.')).toBeVisible();
    await expect(button(page)).toBeDisabled();
    await page.getByRole('radio', { name: /The person asked/ }).check();
    await expect(button(page)).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I understand this cannot be undone' }).check();
    await expect(button(page)).toBeEnabled();
  });

  test('sends the reason and confirmation, then shows what was changed', async ({ page }) => {
    const stub = await stubGovernance(page);
    await openConfirmation(page);

    await page.getByRole('radio', { name: /Your funder has decided/ }).check();
    await page.getByRole('checkbox', { name: 'I understand this cannot be undone' }).check();
    await button(page).click();

    await expect(h1(page, 'Erasure')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${REQUEST}$`));
    await expect(page.getByRole('table', { name: 'Rows changed by tool and table' })).toContainText(
      'Application answer',
    );
    expect(stub.sent.find(({ key }) => key === 'POST /console/erasure-requests')?.body).toEqual({
      partyId: PARTY,
      reason: 'tenant_instruction',
      confirm: true,
    });
  });

  test('goes back to the person when it is not confirmed', async ({ page }) => {
    await stubGovernance(page);
    await page.goto(confirmation);

    await page
      .getByRole('dialog', { name: 'Confirm it is you' })
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(h1(page, 'Amara Okafor')).toBeVisible();
  });

  test('says nothing was erased when the erasure failed', async ({ page }) => {
    await stubGovernance(page, { [READ]: { status: 200, body: failed } });
    await page.goto(statusPage);

    await expect(
      page.getByText(/Nothing was erased, because the whole erasure is rolled back/),
    ).toBeVisible();
  });
});

const showing = (path: string, text: string | RegExp) => async (page: Page) => {
  await page.goto(path);
  await expect(page.getByText(text).first()).toBeVisible();
};

checkStates([
  { name: 'the erasure confirmation', open: openConfirmation },
  {
    name: 'the erasure confirmation ready to submit',
    open: async (page) => {
      await openConfirmation(page);
      await page.getByRole('radio', { name: /The person asked/ }).check();
      await page.getByRole('checkbox', { name: 'I understand this cannot be undone' }).check();
      await expect(button(page)).toBeEnabled();
    },
  },
  {
    name: 'an erasure that is queued',
    stub: (page) => stubGovernance(page, { [READ]: { status: 200, body: queued } }),
    open: showing(statusPage, 'The erasure is queued'),
  },
  { name: 'an erasure that is done', open: showing(statusPage, 'The personal data is erased') },
  {
    name: 'an erasure that failed',
    stub: (page) => stubGovernance(page, { [READ]: { status: 200, body: failed } }),
    open: showing(statusPage, 'The erasure did not finish'),
  },
  {
    name: 'an erasure with nothing changed',
    stub: (page) =>
      stubGovernance(page, { [READ]: { status: 200, body: { ...erased, counts: {} } } }),
    open: showing(statusPage, 'No rows needed changing'),
  },
]);
