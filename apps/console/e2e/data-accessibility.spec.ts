// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the Data page and each of its states, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API's answers stubbed (data-api.ts). In console-production
// they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { stubData } from './data-api.ts';
import type { DataOptions, DataStub } from './data-api.ts';
import { section } from './data-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const busy = problem(503, 'The service is busy. Try again in a minute.');

const downloadFile = (page: Page) =>
  section(page, '360Giving file').getByRole('button', { name: 'Download 360Giving file' });

const downloadSnapshot = (page: Page) =>
  section(page, 'Warehouse snapshot').getByRole('button', { name: 'Download warehouse snapshot' });

/** Opens the page and waits for both sections to finish loading. */
async function openLoaded(page: Page): Promise<void> {
  await page.goto('/northfield/data');
  await expect(section(page, '360Giving file').getByLabel('Funder identifier')).toBeVisible();
  await expect(downloadSnapshot(page)).toBeVisible();
}

interface State {
  name: string;
  options?: DataOptions;
  /** Opens the page and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: DataStub) => Promise<void>;
}

const states: State[] = [
  { name: 'the Data page', open: openLoaded },
  {
    name: 'the Data page with no publisher details saved',
    options: { publisher: null },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(page.getByText('Save your publisher details first')).toBeVisible();
    },
  },
  {
    name: 'the publisher details with problems',
    options: { publisher: null },
    open: async (page) => {
      await page.goto('/northfield/data');
      const panel = section(page, '360Giving file');
      await panel.getByLabel('Funder identifier').fill('northfield');
      await panel.getByLabel('Funder name').fill('Northfield Foundation');
      await panel.getByLabel('Grant identifier prefix').fill('northfield');
      await panel.getByRole('button', { name: 'Save publisher details' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
    },
  },
  {
    name: 'the publisher details once saved',
    options: { publisher: null },
    open: async (page) => {
      await page.goto('/northfield/data');
      const panel = section(page, '360Giving file');
      await panel.getByLabel('Funder identifier').fill('GB-CHC-7654321');
      await panel.getByLabel('Funder name').fill('Northfield Foundation');
      await panel.getByLabel('Grant identifier prefix').fill('360G-northfield');
      await panel.getByRole('button', { name: 'Save publisher details' }).click();
      await expect(panel.getByText('Publisher details saved.')).toBeVisible();
    },
  },
  {
    name: 'the 360Giving file once saved, with recipients to check',
    open: async (page) => {
      await openLoaded(page);
      await downloadFile(page).click();
      await expect(
        section(page, '360Giving file').getByText(
          '1 recipient has an identifier nobody has verified',
        ),
      ).toBeVisible();
    },
  },
  {
    name: 'a round with no released awards',
    open: async (page) => {
      await openLoaded(page);
      await section(page, '360Giving file')
        .getByLabel('Awards to include')
        .selectOption({ label: 'Spring 2027' });
      await downloadFile(page).click();
      await expect(page.getByText(/has no released awards yet/)).toBeVisible();
    },
  },
  {
    name: 'a 360Giving file that could not be made',
    options: { publisher: null },
    open: async (page, stub) => {
      await page.goto('/northfield/data');
      const panel = section(page, '360Giving file');
      await panel.getByLabel('Funder identifier').fill('GB-CHC-7654321');
      await panel.getByLabel('Funder name').fill('Northfield Foundation');
      await panel.getByLabel('Grant identifier prefix').fill('360G-northfield');
      await panel.getByRole('button', { name: 'Save publisher details' }).click();
      await expect(downloadFile(page)).toBeVisible();
      // The details are lost on the server, as when another admin clears them.
      stub.publisher = null;
      await downloadFile(page).click();
      await expect(panel.getByRole('alert')).toContainText('We could not make the file');
    },
  },
  {
    name: 'the warehouse snapshot once saved',
    open: async (page) => {
      await openLoaded(page);
      await downloadSnapshot(page).click();
      await expect(page.getByText('Saved northfield-warehouse-snapshot.sql')).toBeVisible();
    },
  },
  {
    name: 'a warehouse snapshot that could not be made',
    options: { snapshot: { status: busy.status, body: JSON.stringify(busy.body) } },
    open: async (page) => {
      await openLoaded(page);
      await downloadSnapshot(page).click();
      await expect(section(page, 'Warehouse snapshot').getByRole('alert')).toContainText(
        'The service is busy.',
      );
    },
  },
  {
    name: 'the warehouse snapshot while it is being made',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/warehouse/snapshot',
        () => undefined,
      );
      await openLoaded(page);
      await downloadSnapshot(page).click();
      await expect(page.getByText('Making the warehouse snapshot')).toBeVisible();
    },
  },
  {
    name: 'the list of tables in the snapshot',
    open: async (page) => {
      await openLoaded(page);
      await page.getByText(/^Show the \d+ tables$/).click();
      await expect(
        page.getByRole('table', { name: 'Tables in the warehouse snapshot' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the Data page with no programmes',
    options: { programmes: [] },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(page.getByText('No programmes yet')).toBeVisible();
    },
  },
  {
    name: 'the Data page for an administrator who cannot choose a programme',
    options: { permissions: ['platform.warehouse.export', 'grants.data.export'] },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(page.getByText('You cannot choose a programme or round')).toBeVisible();
    },
  },
  {
    name: 'the Data page with only the 360Giving file',
    options: { permissions: ['grants.data.export', 'grants.programmes.manage'] },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(downloadFile(page)).toBeVisible();
      await expect(downloadSnapshot(page)).toHaveCount(0);
    },
  },
  {
    name: 'the Data page with only the warehouse snapshot',
    options: { permissions: ['platform.warehouse.export'] },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(downloadSnapshot(page)).toBeVisible();
      await expect(section(page, '360Giving file')).toHaveCount(0);
    },
  },
  {
    name: 'the Data page while loading',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/exports/360giving/publisher',
        () => undefined,
      );
      await page.goto('/northfield/data');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading the 360Giving details' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the Data page that could not be loaded',
    options: { more: { 'GET /console/exports/360giving/publisher': busy } },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the Data page for someone without the permission',
    options: { permissions: ['grants.programmes.manage'] },
    open: async (page) => {
      await page.goto('/northfield/data');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot download data' }),
      ).toBeVisible();
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

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        const stub = await stubData(page, state.options);
        await state.open(page, stub);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
