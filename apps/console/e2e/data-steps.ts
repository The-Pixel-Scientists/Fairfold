// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 14 as a person does it: a tenant admin opens Data, saves the
// funder's 360Giving details, downloads the 360Giving file and the warehouse
// snapshot, and reads what each holds. The stubbed spec (data.spec.ts) and the
// journey against the real API (data-journey.spec.ts) both take these steps,
// so the screen is checked the same way against each.

import { readFile } from 'node:fs/promises';

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Download, Page } from '@playwright/test';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const section = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });

export interface PublisherDetails {
  funderIdentifier: string;
  funderName: string;
  identifierPrefix: string;
}

/** Opens Data from the navigation. */
export async function openData(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Data' }).click();
  await expect(h1(page, 'Data')).toBeFocused();
  // The page loads its code when it is first opened, which a development server's first compile can slow past five seconds.
  await expect(section(page, '360Giving file')).toBeVisible({ timeout: 15_000 });
  await expect(section(page, 'Warehouse snapshot')).toBeVisible();
}

async function textOf(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8');
}

/** Fills in the publisher details and saves them. */
export async function savePublisher(page: Page, details: PublisherDetails): Promise<void> {
  const panel = section(page, '360Giving file');
  await panel.getByLabel('Funder identifier').fill(details.funderIdentifier);
  await panel.getByLabel('Funder name').fill(details.funderName);
  await panel.getByLabel('Grant identifier prefix').fill(details.identifierPrefix);
  await panel.getByRole('button', { name: 'Save publisher details' }).click();
  await expect(panel.getByText('Publisher details saved.')).toBeVisible();
}

/** Downloads the 360Giving file for a choice such as "Autumn 2026", and checks what the page says about it. */
export async function download360Giving(
  page: Page,
  choice: string,
  grants: number,
): Promise<{ name: string; file: { grants: Record<string, unknown>[] } }> {
  const panel = section(page, '360Giving file');
  await panel.getByLabel('Awards to include').selectOption({ label: choice });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download 360Giving file' }).click(),
  ]);
  const name = download.suggestedFilename();
  expect(name).toMatch(/^360giving-[a-z0-9-]+\.json$/);
  const file = JSON.parse(await textOf(download)) as { grants: Record<string, unknown>[] };
  expect(file.grants).toHaveLength(grants);
  await expect(
    panel.getByText(`Saved ${String(grants)} ${grants === 1 ? 'grant' : 'grants'} to ${name}`, {
      exact: true,
    }),
  ).toBeVisible();
  return { name, file };
}

/** Downloads the warehouse snapshot and checks the page says it is saved. */
export async function downloadSnapshot(page: Page, slug = 'northfield'): Promise<string> {
  const panel = section(page, 'Warehouse snapshot');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download warehouse snapshot' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${slug}-warehouse-snapshot.sql`);
  await expect(panel.getByText(`Saved ${download.suggestedFilename()}`)).toBeVisible();
  return textOf(download);
}
