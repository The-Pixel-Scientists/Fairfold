// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The files on a submission in a real browser, with the API's answers stubbed
// (submissions-files-api.ts): each file question lists its files as downloads
// with their type and size, or says there are none; a link downloads its file
// by keyboard or mouse; and no file name goes in an address. The same page
// runs against the real API in submissions-files-journey.spec.ts.

import { readFile } from 'node:fs/promises';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { attachments, stubFiles } from './submissions-files-api.ts';

const [accounts, , back] = attachments;

const panel = (page: Page) => page.getByRole('tabpanel', { name: 'Application' });
const answerTo = (page: Page, label: string) =>
  panel(page)
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('dd');

const download = (page: Page, name: string) =>
  page.getByRole('link', { name: new RegExp(`^Download ${name},`) });

async function openSubmission(page: Page): Promise<void> {
  const { id } = await stubFiles(page);
  await page.goto(`/northfield/submissions/${id}`);
  await expect(panel(page)).toBeVisible();
}

test.describe('the files on a submission', () => {
  test('lists each file question’s files with their type and size, or says there are none', async ({
    page,
  }) => {
    await openSubmission(page);

    await expect(panel(page).getByRole('heading', { level: 2, name: 'Documents' })).toBeVisible();
    await expect(
      answerTo(page, 'Latest accounts').getByRole('link', {
        name: 'Download accounts-2026.pdf, PDF, 17 B',
      }),
    ).toBeVisible();
    const photos = answerTo(page, 'Photos of the hall').getByRole('link');
    await expect(photos).toHaveCount(2);
    await expect(photos.nth(0)).toHaveAccessibleName('Download hall front.png, PNG image, 17 B');
    await expect(photos.nth(1)).toHaveAccessibleName('Download hall back.png, PNG image, 16 B');
    await expect(answerTo(page, 'Project plan')).toHaveText('No files uploaded');
  });

  test('shows nothing of a question that is not for staff', async ({ page }) => {
    await openSubmission(page);

    await expect(download(page, 'accounts-2026.pdf')).toBeVisible();
    await expect(panel(page).getByText('Applicant notes')).toHaveCount(0);
    await expect(panel(page).getByText('notes.pdf')).toHaveCount(0);
  });

  test('downloads a file with a click and with the keyboard, and the address holds ids only', async ({
    page,
  }) => {
    const addresses: string[] = [];
    page.on('request', (request) => addresses.push(decodeURIComponent(request.url())));
    await openSubmission(page);

    const [clicked] = await Promise.all([
      page.waitForEvent('download'),
      download(page, 'accounts-2026.pdf').click(),
    ]);
    expect(clicked.suggestedFilename()).toBe(accounts?.name);
    expect((await readFile(await clicked.path())).toString()).toBe(accounts?.body);

    await download(page, 'hall back.png').focus();
    const [typed] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Enter'),
    ]);
    expect(typed.suggestedFilename()).toBe(back?.name);
    expect((await readFile(await typed.path())).toString()).toBe(back?.body);

    expect(addresses.filter((address) => /accounts-2026|hall (front|back)/.test(address))).toEqual(
      [],
    );
  });

  test('keeps the downloads in the tab order, one stop for each file', async ({ page }) => {
    await openSubmission(page);

    await download(page, 'accounts-2026.pdf').focus();
    await page.keyboard.press('Tab');
    await expect(download(page, 'hall front.png')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(download(page, 'hall back.png')).toBeFocused();
  });
});
