// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console's navigation for the tools a funder has switched on: which
// sections show, what an address under a hidden tool shows, when a tool's code
// loads, and the keyboard and axe checks. The session is stubbed (auth-api.ts)
// with the modules S11-69 will have the server report.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { consoleSession, stubApi } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';

const tools = ['crm', 'assure', 'forms', 'privacy', 'insight'];
const sections = ['Programmes', 'CRM', 'Due Diligence', 'Forms', 'Data Protection', 'Reporting'];
const permissions = [
  'grants.programmes.manage',
  'crm.records.read',
  'assure.lookup.read',
  'forms.forms.manage',
  'privacy.requests.manage',
  'insight.reports.read',
];

async function openAs(page: Page, modules: string[], held = permissions) {
  await stubApi(page, {
    'GET /auth/session': {
      status: 200,
      body: { ...consoleSession({ permissions: held }), modules },
    },
    'GET /console/programmes': { status: 200, body: { programmes: [] } },
  });
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const names = (page: Page) => navigation(page).getByRole('link').allTextContents();

test.describe('module navigation', () => {
  test('lists a section for each tool that is on and permitted, in a fixed order', async ({
    page,
  }) => {
    await openAs(page, ['grants', ...tools]);
    await page.goto('/northfield/');

    await expect(navigation(page).getByRole('link', { name: 'Reporting' })).toBeVisible();
    expect(await names(page)).toEqual(sections);
  });

  test('shows no section for a tool that is off, and its address is not found', async ({
    page,
  }) => {
    await openAs(page, ['grants', ...tools.filter((tool) => tool !== 'crm')]);
    await page.goto('/northfield/');

    await expect(navigation(page).getByRole('link', { name: 'Reporting' })).toBeVisible();
    expect(await names(page)).toEqual(sections.filter((name) => name !== 'CRM'));

    await page.goto('/northfield/crm');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveTitle(/^Page not found/);
  });

  test('shows no section for a tool the member holds no permission for', async ({ page }) => {
    await openAs(
      page,
      ['grants', ...tools],
      permissions.filter((name) => !name.startsWith('assure.')),
    );
    await page.goto('/northfield/');

    await expect(navigation(page).getByRole('link', { name: 'Reporting' })).toBeVisible();
    expect(await names(page)).toEqual(sections.filter((name) => name !== 'Due Diligence'));
  });

  test('fetches a tool code only when one of its addresses is first opened', async ({ page }) => {
    await openAs(page, ['grants', ...tools]);
    await page.goto('/northfield/');
    await expect(navigation(page).getByRole('link', { name: 'CRM' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Built files have hashed names, so count every script rather than match a name.
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') requested.push(new URL(request.url()).pathname);
    });
    expect(requested).toEqual([]);

    await navigation(page).getByRole('link', { name: 'CRM' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'CRM' })).toBeVisible();
    expect(requested.length).toBeGreaterThan(0);
  });

  test('reaches and opens every section from the keyboard', async ({ page }) => {
    await openAs(page, ['grants', ...tools]);
    await page.goto('/northfield/');
    await expect(navigation(page).getByRole('link', { name: 'Reporting' })).toBeVisible();

    for (const name of sections.slice(1)) {
      await navigation(page).getByRole('link', { name: sections[0] }).focus();
      for (let step = sections.indexOf(name); step > 0; step -= 1) await page.keyboard.press('Tab');
      await expect(navigation(page).getByRole('link', { name })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(navigation(page).getByRole('link', { name })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('has no axe violations @a11y', async ({ page }) => {
    await openAs(page, ['grants', ...tools]);
    for (const { viewport } of widths) {
      await page.setViewportSize(viewport);
      await page.goto('/northfield/crm');
      await expect(page.getByRole('heading', { level: 1, name: 'CRM' })).toBeVisible();
      await expect(navigation(page).getByRole('link', { name: 'CRM' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    }
  });
});
