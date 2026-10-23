// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every submission screen and state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API's answers stubbed (submissions-api.ts). In
// console-production they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { crowd, stubSubmissions } from './submissions-api.ts';
import type { SubmissionStub } from './submissions-api.ts';
import { submissionRows } from './submissions-steps.ts';

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
  stub?: (page: Page) => Promise<SubmissionStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const held = crowd();
const stopped = held[5]?.id ?? '';

const waitForRows = async (page: Page, count = 50) => {
  await expect(submissionRows(page)).toHaveCount(count);
};

async function openMoveDialog(page: Page): Promise<void> {
  await page.goto('/northfield/submissions');
  await waitForRows(page);
  await submissionRows(page).nth(0).getByRole('checkbox').check();
  await submissionRows(page).nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Move to stage' }).click();
  await expect(page.getByRole('dialog', { name: 'Move to stage' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Stage' }).last()).toBeVisible();
}

const states: State[] = [
  {
    name: 'the submissions list',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
    },
  },
  {
    name: 'the submissions list on a later page, with filters',
    open: async (page) => {
      await page.goto('/northfield/submissions?status=submitted');
      await waitForRows(page);
      await page.getByRole('link', { name: 'Next page' }).click();
      await expect(page.getByRole('link', { name: 'Back to the first page' })).toBeVisible();
    },
  },
  {
    name: 'the submissions list with rows chosen',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
      await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
      await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText(
        '50 submissions selected',
      );
    },
  },
  {
    name: 'the submissions list with one row focused',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
      await submissionRows(page).nth(1).focus();
      await expect(submissionRows(page).nth(1)).toBeFocused();
    },
  },
  {
    name: 'the keyboard shortcuts',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for moving submissions to a stage',
    open: openMoveDialog,
  },
  {
    name: 'the dialog for moving submissions after the API refused one',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
      await submissionRows(page).nth(0).getByRole('checkbox').check();
      await submissionRows(page).nth(6).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Move to stage' }).click();
      const dialog = page.getByRole('dialog', { name: 'Move to stage' });
      await dialog.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Review' });
      await dialog.getByRole('button', { name: 'Move 2 submissions to Review' }).click();
      await expect(dialog.getByRole('alert')).toContainText('No submissions were moved.');
    },
  },
  {
    name: 'the submissions list after a move',
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await waitForRows(page);
      await submissionRows(page).nth(0).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Move to stage' }).click();
      const dialog = page.getByRole('dialog', { name: 'Move to stage' });
      await dialog.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Review' });
      await dialog.getByRole('button', { name: 'Move 1 submission to Review' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'moved to Review' })).toBeVisible();
    },
  },
  {
    name: 'the submissions list when the filters match nothing',
    stub: (page) => stubSubmissions(page, crowd(3)),
    open: async (page) => {
      await page.goto('/northfield/submissions?status=withdrawn&late=true');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No submissions match these filters' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the submissions list with no submissions',
    stub: (page) => stubSubmissions(page, []),
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No submissions yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the submissions list while loading',
    open: async (page) => {
      await neverAnswer(page, '/api/console/submissions');
      await page.goto('/northfield/submissions');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading submissions' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the submissions list that could not be loaded',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/submissions',
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await page.goto('/northfield/submissions');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the submissions list with a filter that is not valid',
    open: async (page) => {
      await page.goto('/northfield/submissions?status=bogus');
      await expect(
        page.getByRole('heading', { level: 2, name: 'These filters are not valid' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the submissions list for someone without the permission',
    stub: (page) => stubSubmissions(page, crowd(), {}, ['grants.reviews.score']),
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot view submissions' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a submission',
    open: async (page) => {
      await page.goto(`/northfield/submissions/${held[1]?.id ?? ''}?status=submitted`);
      await expect(page.getByRole('tabpanel', { name: 'Application' })).toContainText(
        'We run a weekly lunch.',
      );
      await expect(page.getByRole('link', { name: 'Next submission' })).toBeVisible();
    },
  },
  {
    name: 'the eligibility of a submission that was stopped',
    open: async (page) => {
      await page.goto(`/northfield/submissions/${stopped}`);
      await page.getByRole('tab', { name: 'Eligibility' }).click();
      await expect(
        page.getByRole('region', { name: 'Where the applicant was stopped' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the history of a submission',
    open: async (page) => {
      await page.goto(`/northfield/submissions/${held[1]?.id ?? ''}`);
      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.getByRole('list', { name: 'History, newest first' })).toBeVisible();
    },
  },
  {
    name: 'a withdrawn submission with no eligibility check',
    open: async (page) => {
      // The 11th has no eligibility check on record.
      await page.goto(`/northfield/submissions/${held[10]?.id ?? ''}`);
      await page.getByRole('tab', { name: 'Eligibility' }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'No eligibility check yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a submission while loading',
    open: async (page) => {
      await neverAnswer(page, `/api/console/submissions/${held[1]?.id ?? ''}`);
      await page.goto(`/northfield/submissions/${held[1]?.id ?? ''}`);
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading the submission' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a submission that could not be found',
    open: async (page) => {
      await page.goto('/northfield/submissions/00000000-0000-4000-8000-000000009999');
      await expect(page.getByText('There is no submission with this address.')).toBeVisible();
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
        await (state.stub ?? ((target) => stubSubmissions(target, crowd())))(page);
        await state.open(page);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
