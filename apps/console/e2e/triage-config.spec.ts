// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Labels and reminder history in a real browser, with the API's answers
// stubbed: a manager adds a label to chosen submissions in one request, keeps
// the label set, and reads the reminders for a submission only once the
// section is opened. The axe checks cover each state at desktop width, at
// 320 px wide and at 200% zoom; in console-production they run under the
// production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import type { Handler } from './auth-api.ts';
import { crowd, stubSubmissions } from './submissions-api.ts';
import { submissionRows } from './submissions-steps.ts';

const expect = strictExpect.configure({ timeout: 15_000 });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const call = { id: uuid(9001), name: 'Needs a call', colour: 'warning', archived: false };
const pilot = { id: uuid(9002), name: 'Pilot cohort', colour: null, archived: true };

const held = crowd();

const labels = (): Record<string, Handler> => ({
  'GET /console/labels': { status: 200, body: { labels: [call, pilot] } },
});

/** Records what the bulk change sent, as the page does, and changes what the body names. */
async function stubBulkLabels(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(
    (url) => url.pathname === '/api/console/submission-labels',
    async (route) => {
      const body: unknown = route.request().postDataJSON();
      bodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          changed: (body as { submissionIds: string[] }).submissionIds.length,
        }),
      });
    },
  );
  return bodies;
}

async function openAddLabels(page: Page): Promise<void> {
  await page.goto('/northfield/submissions');
  await expect(submissionRows(page)).toHaveCount(50);
  await submissionRows(page).nth(0).getByRole('checkbox').check();
  await submissionRows(page).nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Add labels' }).click();
  await expect(page.getByRole('dialog', { name: 'Add labels' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Needs a call' })).toBeVisible();
}

/** Answers after stubSubmissions, so it comes before that stub's catch-all for submission addresses. */
async function stubReminders(page: Page): Promise<void> {
  await page.route(
    (url) => /^\/api\/console\/submissions\/[^/]+\/reminders$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reminders: [
            {
              kind: 'draft_closing',
              at: '2026-10-25T16:00:00.000Z',
              outcome: 'sent',
              reason: null,
            },
          ],
        }),
      }),
  );
}

async function openReminders(page: Page): Promise<void> {
  await page.goto(`/northfield/submissions/${held[1]?.id ?? ''}`);
  await page.getByRole('button', { name: 'Show reminders' }).click();
  await expect(page.getByText('Application closing soon')).toBeVisible();
}

test.describe('labels and reminders', () => {
  test('adds a label to two chosen submissions in one request', async ({ page }) => {
    await stubSubmissions(page, held, labels());
    const bodies = await stubBulkLabels(page);
    await openAddLabels(page);

    await page.getByRole('checkbox', { name: 'Needs a call' }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Add labels' }).click();

    await expect(page.getByText('Labels added to 2 submissions.')).toBeVisible();
    expect(bodies).toEqual([
      { submissionIds: [held[0]?.id, held[1]?.id], add: [call.id], remove: [] },
    ]);
    await expect(page).toHaveURL(/\/northfield\/submissions$/);
  });

  test('keeps the label set with no way to delete and marks archived labels', async ({ page }) => {
    await stubSubmissions(page, held, labels());
    await page.goto('/northfield/labels');

    const table = page.getByRole('table', { name: 'Labels' });
    await expect(table).toContainText('Pilot cohort (archived)');
    await expect(table.getByRole('button', { name: 'Archive Needs a call' })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  });

  test('keeps focus in the page after creating and archiving a label', async ({ page }) => {
    const fresh = { id: uuid(9003), name: 'Site visit', colour: 'neutral', archived: false };
    await stubSubmissions(page, held, {
      ...labels(),
      'POST /console/labels': { status: 201, body: fresh },
      [`POST /console/labels/${call.id}/archive`]: {
        status: 200,
        body: { ...call, archived: true },
      },
    });
    await page.goto('/northfield/labels');
    const status = page.getByRole('status').filter({ hasText: /^Label/ });

    await page.getByLabel('Name').fill(fresh.name);
    await page.getByRole('button', { name: 'Create label' }).click();
    await expect(status).toHaveText('Label created.');
    await expect(status).toBeFocused();

    await page.getByRole('button', { name: 'Archive Needs a call' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive Needs a call' }).click();
    await expect(status).toHaveText('Label archived.');
    await expect(status).toBeFocused();
  });

  test('reads the reminders for a submission only when the section is opened', async ({ page }) => {
    await stubSubmissions(page, held);
    let read = false;
    await stubReminders(page);
    await page.route(/\/reminders$/, (route) => {
      read = true;
      return route.fallback();
    });
    await page.goto(`/northfield/submissions/${held[1]?.id ?? ''}`);
    await expect(page.getByRole('region', { name: 'Reminders' })).toBeVisible();
    expect(read).toBe(false);

    await page.getByRole('button', { name: 'Show reminders' }).click();

    await expect(page.getByText('Application closing soon')).toBeVisible();
    await expect(page.getByText('25 October 2026 at 4pm. Sent.')).toBeVisible();
  });
});

interface State {
  name: string;
  stub: Record<string, Handler>;
  routes?: (page: Page) => Promise<void>;
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  { name: 'the dialog for adding labels', stub: labels(), open: openAddLabels },
  {
    name: 'the label set manager',
    stub: labels(),
    open: async (page) => {
      await page.goto('/northfield/labels');
      await expect(page.getByRole('table', { name: 'Labels' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for archiving a label',
    stub: labels(),
    open: async (page) => {
      await page.goto('/northfield/labels');
      await page.getByRole('button', { name: 'Archive Needs a call' }).click();
      await expect(page.getByRole('dialog', { name: 'Archive label' })).toBeVisible();
    },
  },
  { name: 'the reminders of a submission', stub: {}, routes: stubReminders, open: openReminders },
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
        await stubSubmissions(page, held, state.stub);
        await state.routes?.(page);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
