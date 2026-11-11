// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The subject access screens in a real browser, with the API's answers
// stubbed (governance-api.ts), and their axe checks at every width. The same
// journey against the real API needs the file download route and a seeded
// person on the stack. Every spec also fails on a Content Security Policy
// violation, so the screens are checked under the production policy in
// console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import {
  FILE,
  PARTY,
  REQUEST,
  checkStates,
  confirmItsYou,
  expired,
  failed,
  h1,
  queued,
  ready,
  stubGovernance,
} from './governance-api.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const person = `/northfield/settings/subject-access/people/${PARTY}`;
const exportPage = `/northfield/settings/subject-access/exports/${REQUEST}`;
const READ = `GET /console/subject-access-requests/${REQUEST}`;
const CREATE = 'POST /console/subject-access-requests';
/** The development build mounts each page twice, so the first two reads both stay queued. */
const QUEUED_READS = 2;

test.describe('subject access', () => {
  test('finds a person, creates an export after step-up and offers the download', async ({
    page,
  }) => {
    const stub = await stubGovernance(page);
    await page.goto('/northfield/settings/subject-access');

    await page.getByLabel('Name or email address').fill('amara');
    await page.getByRole('button', { name: 'Find person' }).click();
    await page.getByRole('link', { name: 'Choose Amara Okafor' }).click();
    await expect(h1(page, 'Amara Okafor')).toBeVisible();
    await expect(page).toHaveTitle('Subject access and erasure – Fairfold Grants console');
    expect(page.url()).not.toContain('amara');

    await page.getByRole('button', { name: 'Create subject access export' }).click();
    await confirmItsYou(page);

    await expect(page).toHaveURL(new RegExp(`${REQUEST}$`));
    await expect(page.getByRole('link', { name: 'Download export (JSON)' })).toHaveAttribute(
      'href',
      `/api/console/files/${FILE}`,
    );
    await expect(page.getByText(/17 November 2026, 9:30am UK time/)).toBeVisible();
    expect(stub.sent.filter(({ key }) => key === CREATE).map(({ body }) => body)).toEqual([
      { partyId: PARTY },
      { partyId: PARTY },
    ]);
  });

  test('says an export is queued, then announces when it is ready', async ({ page }) => {
    let reads = 0;
    await stubGovernance(page, {
      [READ]: () => {
        reads += 1;
        return reads <= QUEUED_READS ? { status: 200, body: queued } : { status: 200, body: ready };
      },
    });
    await page.goto(exportPage);

    await expect(page.getByText('Your export is queued')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveText(
      'Your export is ready to download.',
    );
    await expect(page.getByRole('link', { name: 'Download export (JSON)' })).toBeVisible();
  });

  test('announces when an export could not be made', async ({ page }) => {
    let reads = 0;
    await stubGovernance(page, {
      [READ]: () => {
        reads += 1;
        return reads <= QUEUED_READS
          ? { status: 200, body: queued }
          : { status: 200, body: failed };
      },
    });
    await page.goto(exportPage);

    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveText(
      'The export could not be made.',
    );
  });

  test('shows the same not found screen for a request that is not yours', async ({ page }) => {
    await stubGovernance(page, { [READ]: problem(404, 'Not found.') });
    await page.goto(exportPage);

    await expect(h1(page, 'Not found')).toBeVisible();
  });

  test('says a deleted file has been deleted and offers a way to ask again', async ({ page }) => {
    await stubGovernance(page, { [READ]: { status: 200, body: expired } });
    await page.goto(exportPage);

    await expect(page.getByText('This export has been deleted')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find a person' })).toBeVisible();
  });
});

const showing = (path: string, text: string | RegExp) => async (page: Page) => {
  await page.goto(path);
  await expect(page.getByText(text).first()).toBeVisible();
};

checkStates([
  {
    name: 'find a person',
    open: async (page) => {
      await page.goto('/northfield/settings/subject-access');
      await expect(h1(page, 'Subject access and erasure')).toBeVisible();
    },
  },
  {
    name: 'find a person with results',
    open: async (page) => {
      await page.goto('/northfield/settings/subject-access');
      await page.getByLabel('Name or email address').fill('amara');
      await page.getByRole('button', { name: 'Find person' }).click();
      await expect(page.getByRole('link', { name: 'Choose Amara Okafor' })).toBeVisible();
    },
  },
  {
    name: 'find a person with no results',
    stub: (page) =>
      stubGovernance(page, {
        'POST /console/crm/search': { status: 200, body: { results: [], nextCursor: null } },
      }),
    open: async (page) => {
      await page.goto('/northfield/settings/subject-access');
      await page.getByLabel('Name or email address').fill('nobody');
      await page.getByRole('button', { name: 'Find person' }).click();
      await expect(page.getByRole('heading', { name: 'No people found' })).toBeVisible();
    },
  },
  { name: 'the person page', open: showing(person, /Only you can download it/) },
  {
    name: 'an export that is queued',
    stub: (page) => stubGovernance(page, { [READ]: { status: 200, body: queued } }),
    open: showing(exportPage, 'Your export is queued'),
  },
  { name: 'an export that is ready', open: showing(exportPage, 'Your export is ready') },
  {
    name: 'an export that failed',
    stub: (page) => stubGovernance(page, { [READ]: { status: 200, body: failed } }),
    open: showing(exportPage, 'The export could not be made'),
  },
  {
    name: 'an export that has expired',
    stub: (page) => stubGovernance(page, { [READ]: { status: 200, body: expired } }),
    open: showing(exportPage, 'This export has been deleted'),
  },
  {
    name: 'a request that is not found',
    stub: (page) => stubGovernance(page, { [READ]: problem(404, 'Not found.') }),
    open: async (page) => {
      await page.goto(exportPage);
      await expect(h1(page, 'Not found')).toBeVisible();
    },
  },
]);
