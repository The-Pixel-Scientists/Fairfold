// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approvals screens in a real browser, with the API's answers stubbed
// (approvals-api.ts) and checked against the contract. The same approve
// journey runs against the real API in approvals-journey.spec.ts. Axe checks
// carry the @a11y tag.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { REQUEST_ID, stubApprovals } from './approvals-api.ts';
import { northfield } from './auth-api.ts';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const status = (page: Page) => page.getByRole('status').filter({ hasText: /\S/ });

async function openRequest(page: Page): Promise<void> {
  await page.goto(`/northfield/approvals/${REQUEST_ID}`);
  await expect(page.getByText('0 of 1 approval')).toBeVisible();
}

async function confirmItsYou(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await dialog.getByLabel('Password').fill('correct horse battery');
  await dialog.getByLabel('Code from your authenticator app').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('the approvals inbox', () => {
  test('opens from the navigation with focus on the heading and lists what is waiting', async ({
    page,
  }) => {
    await stubApprovals(page);
    await page.goto('/northfield/settings');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Approvals' })
      .click();

    await expect(h1(page, 'Approvals')).toBeFocused();
    const row = page.getByRole('row', { name: /Payment approval/ });
    await expect(row).toContainText('A colleague');
    await expect(row).toContainText('20 November 2026, 2:05pm');
    await row.getByRole('link', { name: 'Payment approval' }).click();
    await expect(h1(page, 'Approval request')).toBeFocused();
    await page.goBack();
    await expect(h1(page, 'Approvals')).toBeVisible();
  });

  test('says what to do when nothing is waiting', async ({ page }) => {
    await stubApprovals(page, { listed: [] });
    await page.goto('/northfield/approvals');
    await expect(page.getByRole('heading', { name: 'Nothing is waiting for you' })).toBeVisible();
  });
});

test.describe('an approval request', () => {
  test('shows the requester no approve button and says why', async ({ page }) => {
    await stubApprovals(page, {
      request: { requestedBy: northfield.id, canDecide: false, canWithdraw: true },
    });
    await openRequest(page);
    await expect(
      page.getByText('You made this request, so someone else must approve it.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
  });

  test('approves through step-up, by keyboard alone, and says so once', async ({ page }) => {
    const stub = await stubApprovals(page);
    await openRequest(page);

    await page.getByRole('button', { name: 'Approve request' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Approve this request?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve request' }).focus();
    await page.keyboard.press('Enter');
    await confirmItsYou(page);

    await expect(status(page)).toHaveText('Request approved');
    await expect(status(page)).toBeFocused();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Approved by you/)).toBeVisible();
    expect(stub.sent.filter(({ key }) => key.endsWith('/approve'))).toHaveLength(2);
  });

  test('asks for a reason to reject, sends it in the body, and keeps it out of the address', async ({
    page,
  }) => {
    const stub = await stubApprovals(page, { recent: true });
    await openRequest(page);

    await page.getByRole('button', { name: 'Reject request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject this request?' });
    await dialog.getByRole('button', { name: 'Reject request' }).click();
    await expect(dialog.getByText('Choose a reason.').first()).toBeVisible();
    await expect(dialog.getByRole('alert')).toBeFocused();

    await dialog.getByRole('radio', { name: 'Evidence is missing' }).check();
    await dialog.getByRole('button', { name: 'Reject request' }).click();
    await expect(status(page)).toHaveText('Request rejected');
    await expect(status(page)).toBeFocused();
    expect(stub.sent.find(({ key }) => key.endsWith('/reject'))?.body).toEqual({
      reasonCode: 'missing_evidence',
    });
    expect(page.url()).not.toContain('missing_evidence');
  });

  test('shows a refusal without echoing what was sent', async ({ page }) => {
    await stubApprovals(page, {
      recent: true,
      more: {
        [`POST /console/approvals/${REQUEST_ID}/approve`]: problem(
          409,
          'Someone else has already decided this request.',
        ),
      },
    });
    await openRequest(page);
    await page.getByRole('button', { name: 'Approve request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this request?' });
    await dialog.getByRole('button', { name: 'Approve request' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Someone else has already decided this request.',
    );
    await expect(dialog).not.toContainText(REQUEST_ID);
  });

  test('returns focus to the button when the person cancels the confirmation', async ({ page }) => {
    const stub = await stubApprovals(page);
    await openRequest(page);
    await page.getByRole('button', { name: 'Approve request' }).click();
    await page
      .getByRole('dialog', { name: 'Approve this request?' })
      .getByRole('button', { name: 'Approve request' })
      .click();
    await page
      .getByRole('dialog', { name: 'Confirm it is you' })
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve request' })).toBeFocused();
    expect(stub.request.status).toBe('pending');
  });
});

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    const states: { name: string; open: (page: Page) => Promise<void> }[] = [
      {
        name: 'the inbox',
        open: async (page) => {
          await page.goto('/northfield/approvals');
          await expect(page.getByRole('row', { name: /Payment approval/ })).toBeVisible();
        },
      },
      { name: 'the request page', open: openRequest },
      {
        name: 'the decision dialog',
        open: async (page) => {
          await openRequest(page);
          await page.getByRole('button', { name: 'Reject request' }).click();
          await expect(page.getByRole('dialog', { name: 'Reject this request?' })).toBeVisible();
        },
      },
      {
        name: 'the step-up dialog over it',
        open: async (page) => {
          await openRequest(page);
          await page.getByRole('button', { name: 'Approve request' }).click();
          await page
            .getByRole('dialog', { name: 'Approve this request?' })
            .getByRole('button', { name: 'Approve request' })
            .click();
          await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
        },
      },
    ];

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await stubApprovals(page);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
