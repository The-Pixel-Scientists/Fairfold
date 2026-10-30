// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log in a real browser, with the API's answers stubbed
// (audit-log-api.ts): a funder whose log holds 250 events, listed with the
// contract's filters and pages. The same steps run against the real API in
// audit-log-journey.spec.ts. Every spec also fails on a Content Security
// Policy violation, so the screen is checked under the production policy in
// console-production.

// The callbacks passed to evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { stubAuditLog } from './audit-log-api.ts';
import {
  auditRows,
  auditTable,
  filterToGrantsAndDates,
  findRelease,
  openAuditLog,
} from './audit-log-steps.ts';

const SUFFIX = `– ${productName} console`;

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe('reading the audit log', () => {
  test('is reached from the navigation, with the page title, focus on the heading and the newest events first', async ({
    page,
  }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/settings');
    await openAuditLog(page);

    await expect(page).toHaveTitle(`Audit log ${SUFFIX}`);
    await expect(auditRows(page)).toHaveCount(100);
    await expect(auditRows(page).first()).toContainText('30 October 2026, 3:00pm');
    await expect(
      page.getByText('Showing the newest 100 events. Load more to see older ones.'),
    ).toBeVisible();
  });

  test('filters to Grants and the dates, finds the release and opens its details', async ({
    page,
  }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/audit-log');
    await expect(auditTable(page)).toBeVisible();

    await filterToGrantsAndDates(page, '2026-10-26', '2026-10-30');
    await findRelease(page);
  });

  test('keeps the filters in the address, and Back brings them back', async ({ page }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/audit-log');
    await expect(auditRows(page)).toHaveCount(100);

    await page.getByRole('combobox', { name: 'Module' }).selectOption({ label: 'Platform' });
    await page.getByRole('combobox', { name: 'Person' }).selectOption({ label: 'Ada Morgan' });
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/\?module=platform&byMembershipId=[0-9a-f-]+$/);
    await expect(auditRows(page)).toHaveCount(100);
    await expect(auditRows(page).filter({ hasText: 'Marcus Bell' })).toHaveCount(0);

    await page.getByLabel('Entity ID').fill('0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('No events match these filters')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\?module=platform&byMembershipId=[0-9a-f-]+$/);
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('platform');
    await expect(page.getByLabel('Entity ID')).toHaveValue('');
    await page.goBack();
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Person' })).toHaveValue('');
  });

  test('loads more events below the first ones and moves focus to the first new row', async ({
    page,
  }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/audit-log');
    await expect(auditRows(page)).toHaveCount(100);

    await page.getByRole('button', { name: 'Load more events' }).click();
    await expect(auditRows(page)).toHaveCount(200);
    await expect(auditRows(page).nth(100)).toBeFocused();

    await page.getByRole('button', { name: 'Load more events' }).click();
    await expect(auditRows(page)).toHaveCount(250);
    await expect(auditRows(page).nth(200)).toBeFocused();
    await expect(page.getByText('Showing all 250 events, newest first.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Load more events/ })).toHaveCount(0);
  });

  test('returns to where the person was in a long list, with its filters', async ({ page }) => {
    await stubAuditLog(page);
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/northfield/audit-log?module=grants');
    await expect(auditRows(page)).toHaveCount(100);

    const row = auditRows(page).nth(60);
    await row.scrollIntoViewIfNeeded();
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(600);
    // A click that scrolled the link into view would move the page first, so click it without.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .evaluate((link: HTMLElement) => {
        link.click();
      });
    await expect(page).toHaveURL(/\/northfield\/settings$/);
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();

    await page.goBack();
    await expect(auditRows(page).nth(60)).toBeVisible();
    await expect.poll(() => scrollY(page)).toBe(before);
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('grants');
  });

  test('is operated from the keyboard: arrows move between rows, Enter shows the details, ? lists the keys', async ({
    page,
  }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/audit-log');
    const rows = auditRows(page);
    await expect(rows).toHaveCount(100);

    // Tab reaches the table's region, and then the first row, which is the only row on the Tab path.
    await page.getByRole('button', { name: 'Apply filters' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press('End');
    await expect(rows.nth(99)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rows.nth(0)).toBeFocused();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
      'Show the details of the event',
    );
    await page.keyboard.press('Escape');
    await expect(rows.nth(0)).toBeFocused();

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Application stage changed' });
    await expect(dialog).toContainText('Changed');
    await expect(dialog).toContainText('Before');
    await expect(dialog).toContainText('submitted');
    await page.keyboard.press('Escape');
    await expect(rows.nth(0)).toBeFocused();
  });

  test('says which filters to change when none match, and clears them', async ({ page }) => {
    await stubAuditLog(page);
    await page.goto('/northfield/audit-log?module=party');

    await expect(
      page.getByRole('heading', { level: 2, name: 'No events match these filters' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(page).not.toHaveURL(/\?/);
    await expect(auditRows(page)).toHaveCount(100);
  });

  test('is closed to an administrator who cannot read the log', async ({ page }) => {
    await stubAuditLog(page, undefined, {}, ['platform.settings.manage']);
    await page.goto('/northfield/audit-log');

    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot read the audit log' }),
    ).toBeVisible();
    await expect(auditTable(page)).toHaveCount(0);
  });
});
