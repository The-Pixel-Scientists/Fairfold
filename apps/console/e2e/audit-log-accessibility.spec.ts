// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the audit log and each of its states, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API's answers stubbed (audit-log-api.ts). In
// console-production they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { crowd, stubAuditLog } from './audit-log-api.ts';
import type { AuditStub } from './audit-log-api.ts';
import { auditRows } from './audit-log-steps.ts';
import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const busy = problem(503, 'The service is busy. Try again in a minute.');

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

interface State {
  name: string;
  /** Sets the API's answers for this state. */
  stub?: (page: Page) => Promise<AuditStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const waitForRows = async (page: Page, count = 100) => {
  await expect(auditRows(page)).toHaveCount(count);
};

const states: State[] = [
  {
    name: 'the audit log',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
    },
  },
  {
    name: 'the audit log with filters applied',
    open: async (page) => {
      await page.goto('/northfield/audit-log?module=grants&from=2026-10-26&to=2026-10-30');
      await expect(auditRows(page).first()).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('grants');
    },
  },
  {
    name: 'the audit log with all its events loaded',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await page.getByRole('button', { name: 'Load more events' }).click();
      await waitForRows(page, 200);
      await page.getByRole('button', { name: 'Load more events' }).click();
      await waitForRows(page, 250);
    },
  },
  {
    name: 'the audit log with one row focused',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await auditRows(page).nth(1).focus();
      await expect(auditRows(page).nth(1)).toBeFocused();
    },
  },
  {
    name: 'the audit log with a filter that is not valid',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await page.getByLabel('Entity ID').fill('abc');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page.getByText(/Enter the whole ID/)).toBeVisible();
    },
  },
  {
    name: 'the details of an event with changed fields',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await auditRows(page)
        .first()
        .getByRole('button', { name: /^View details/ })
        .click();
      await expect(page.getByRole('dialog', { name: 'Application stage changed' })).toContainText(
        'What changed',
      );
    },
  },
  {
    name: 'the details of an event that changed no fields',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await auditRows(page)
        .nth(1)
        .getByRole('button', { name: /^View details/ })
        .click();
      await expect(page.getByRole('dialog')).toContainText('This event did not change any fields.');
    },
  },
  {
    name: 'the keyboard shortcuts',
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await waitForRows(page);
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'the audit log when the filters match nothing',
    open: async (page) => {
      await page.goto('/northfield/audit-log?module=party');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No events match these filters' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the audit log with no events',
    stub: (page) => stubAuditLog(page, []),
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await expect(page.getByRole('heading', { level: 2, name: 'No events yet' })).toBeVisible();
    },
  },
  {
    name: 'the audit log while loading',
    open: async (page) => {
      await neverAnswer(page, '/api/console/audit-events');
      await page.goto('/northfield/audit-log');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading the audit log' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the audit log that could not be loaded',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/audit-events',
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await page.goto('/northfield/audit-log');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the audit log with an address that is not valid',
    open: async (page) => {
      await page.goto('/northfield/audit-log?module=bogus');
      await expect(
        page.getByRole('heading', { level: 2, name: 'These filters are not valid' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the audit log for someone without the permission',
    stub: (page) => stubAuditLog(page, crowd(), {}, ['platform.settings.manage']),
    open: async (page) => {
      await page.goto('/northfield/audit-log');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot read the audit log' }),
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
        await (state.stub ?? ((target) => stubAuditLog(target)))(page);
        await state.open(page);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
