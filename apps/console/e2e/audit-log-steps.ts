// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 15 as a person does it: a tenant admin opens the audit log,
// narrows it to Grants and the round's dates, and finds the release. The
// stubbed spec (audit-log.spec.ts) and the journey against the real API
// (audit-log-journey.spec.ts) both take these steps, so the screen is checked
// the same way against each.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const auditTable = (page: Page) =>
  page.getByRole('table', { name: 'Events in the audit log, newest first' });

/** The rows of the table, the heading row left out. */
export const auditRows = (page: Page) => auditTable(page).locator('tbody > tr');

/** Opens the audit log from the navigation. */
export async function openAuditLog(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Audit log' })
    .click();
  await expect(h1(page, 'Audit log')).toBeFocused();
  await expect(auditTable(page)).toBeVisible();
}

/** Narrows the log to Grants and the dates, applies the filters, and checks the address says so. */
export async function filterToGrantsAndDates(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Module' }).selectOption({ label: 'Grants' });
  await page.getByLabel('From').fill(from);
  await page.getByLabel('To').fill(to);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?module=grants&from=${from}&to=${to}$`));
  await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('grants');
  await expect(auditRows(page).first()).toBeVisible();
}

/** Finds the release of decisions among the events, and opens its details. */
export async function findRelease(page: Page): Promise<void> {
  const release = auditRows(page).filter({ hasText: 'Decision released' }).first();
  await expect(release).toBeVisible();
  await release.getByRole('button', { name: /^View details/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Decision released' });
  await expect(dialog).toContainText('Grants');
  await expect(dialog).toContainText('What changed');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}
