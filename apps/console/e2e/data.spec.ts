// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Data page in a real browser, with the API's answers stubbed
// (data-api.ts): the 360Giving details, the 360Giving file and the warehouse
// snapshot are saved as files. The same steps run against the real API in
// data-journey.spec.ts. Every spec also fails on a Content Security Policy
// violation, so the page is checked under the production policy in
// console-production: nothing needs a new source.

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { awards, publisher, SNAPSHOT, stubData } from './data-api.ts';
import {
  download360Giving,
  downloadSnapshot,
  h1,
  openData,
  savePublisher,
  section,
} from './data-steps.ts';

const SUFFIX = `– ${productName} console`;

test.describe('downloading data', () => {
  test('is reached from the navigation, with the page title and focus on the heading', async ({
    page,
  }) => {
    await stubData(page);
    await page.goto('/northfield/settings');
    await openData(page);

    await expect(page).toHaveTitle(`Data ${SUFFIX}`);
    await expect(page.getByText('Anything an applicant wrote')).toHaveCount(2);
    await expect(page.getByText('Personal details of any kind')).toBeVisible();
  });

  test('saves the details, then the 360Giving file and the snapshot, and says what each holds', async ({
    page,
  }) => {
    const stub = await stubData(page, { publisher: null });
    await page.goto('/northfield/data');
    await expect(h1(page, 'Data')).toBeVisible();
    await expect(page.getByText('Save your publisher details first')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download 360Giving file' })).toHaveCount(0);

    await savePublisher(page, publisher);
    expect(stub.publisher).toMatchObject({ funderIdentifier: 'GB-CHC-7654321' });

    const { name, file } = await download360Giving(page, 'Autumn 2026', awards.length);
    expect(name).toBe('360giving-community-spaces-fund-autumn-2026.json');
    expect(file.grants.map((grant) => grant['id'])).toEqual(awards.map((grant) => grant.id));
    const warning = section(page, '360Giving file').getByText(
      '1 recipient has an identifier nobody has verified',
    );
    await expect(warning).toBeVisible();
    await expect(section(page, '360Giving file').getByText('Riverside Lunch Club')).toBeVisible();

    expect(await downloadSnapshot(page)).toBe(SNAPSHOT);
    expect(stub.asked).toEqual({ exports: 1, snapshots: 1 });
  });

  test('checks the details in words before anything is saved', async ({ page }) => {
    const stub = await stubData(page, { publisher: null });
    await page.goto('/northfield/data');
    const panel = section(page, '360Giving file');

    await panel.getByLabel('Funder identifier').fill('northfield');
    await panel.getByLabel('Funder name').fill('Northfield Foundation');
    await panel.getByLabel('Grant identifier prefix').fill('northfield');
    await panel.getByRole('button', { name: 'Save publisher details' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText([
      "Enter the funder's identifier from org-id.guide, like GB-CHC-1234567.",
      'Enter the prefix 360Giving gave the funder, like 360G-northfield.',
    ]);
    expect(stub.publisher).toBeNull();
  });

  test('tells the admin when a round has no released awards, and saves no file', async ({
    page,
  }) => {
    await stubData(page);
    await page.goto('/northfield/data');
    const panel = section(page, '360Giving file');
    await panel.getByLabel('Awards to include').selectOption({ label: 'Spring 2027' });

    await panel.getByRole('button', { name: 'Download 360Giving file' }).click();

    await expect(
      panel.getByText('Community Spaces Fund, Spring 2027 has no released awards yet'),
    ).toBeVisible();
  });

  test('shows a refused snapshot in words and lets the admin try again', async ({ page }) => {
    await stubData(page, {
      snapshot: {
        status: 413,
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Problem',
          status: 413,
          detail: 'This snapshot is larger than 50 MB. Ask your operator for a copy.',
          requestId: 'req_e2e',
        }),
      },
    });
    await page.goto('/northfield/data');
    const panel = section(page, 'Warehouse snapshot');

    await panel.getByRole('button', { name: 'Download warehouse snapshot' }).click();

    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('We could not make the snapshot');
    await expect(alert).toContainText('Ask your operator for a copy.');
    await expect(panel.getByRole('button', { name: 'Download warehouse snapshot' })).toBeEnabled();
  });

  test('links to the loading guide, which opens in a new tab', async ({ page }) => {
    await stubData(page);
    await page.goto('/northfield/data');

    const guide = section(page, 'Warehouse snapshot').getByRole('link', {
      name: /How to load the snapshot/,
    });
    await expect(guide).toHaveAttribute('href', /warehouse-snapshot\.md$/);
    await expect(guide).toHaveAttribute('target', '_blank');
  });

  test('works from the keyboard alone', async ({ page }) => {
    await stubData(page);
    await page.goto('/northfield/data');
    const panel = section(page, 'Warehouse snapshot');
    const button = panel.getByRole('button', { name: 'Download warehouse snapshot' });

    await button.focus();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Enter'),
    ]);

    expect(download.suggestedFilename()).toBe('northfield-warehouse-snapshot.sql');
    await expect(button).toBeFocused();
  });

  test('is closed to someone without either permission, and is not in the navigation', async ({
    page,
  }) => {
    await stubData(page, { permissions: ['grants.programmes.manage'] });
    await page.goto('/northfield/data');

    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot download data' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Data' }),
    ).toHaveCount(0);
  });
});
