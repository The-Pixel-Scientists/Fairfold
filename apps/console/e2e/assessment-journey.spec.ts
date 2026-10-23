// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo steps 10 and 11 against the real API: a programme manager has two
// reviewers assigned to each submission in Review and reads the spread of
// scores, then a reviewer declares one conflict, scores another review by
// keyboard and submits it. The steps are those of assessment.spec.ts, which
// runs them against a stand-in. It needs the stack (`pnpm stack`, then
// `pnpm test:stack`) and the seed's `applications` scenario, which holds six
// submitted applications to the Autumn 2026 round with Northfield's two
// reviewers in its pool and assigned to those in Review:
//
//   TPS_E2E_MANAGER_EMAIL     the programme manager's email address
//   TPS_E2E_MANAGER_PASSWORD  the seed password
//   TPS_E2E_MANAGER_TOTP_KEY  the manager's authenticator key, once set up
//   TPS_E2E_REVIEWER_EMAIL    the email address of a Northfield reviewer in
//                             the pool, such as Priya Shah
//   TPS_E2E_REVIEWER_PASSWORD the seed password
//   TPS_E2E_REVIEWER_TOTP_KEY the reviewer's authenticator key, once set up
//
// The first run of each person sets up their authenticator app and prints
// the key, which the next runs need.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import {
  assignAutomatically,
  declareConflict,
  h1,
  reviewRows,
  scoreFromTheKeyboard,
  spreadRows,
  spreadTable,
  submitReview,
} from './assessment-steps.ts';
import { nextCode } from './auth-totp.ts';
import { submissionRows, submissionsTable } from './submissions-steps.ts';

const MANAGER = {
  email: process.env['TPS_E2E_MANAGER_EMAIL'],
  password: process.env['TPS_E2E_MANAGER_PASSWORD'],
  key: process.env['TPS_E2E_MANAGER_TOTP_KEY'],
};
const REVIEWER = {
  email: process.env['TPS_E2E_REVIEWER_EMAIL'],
  password: process.env['TPS_E2E_REVIEWER_PASSWORD'],
  key: process.env['TPS_E2E_REVIEWER_TOTP_KEY'],
};

interface Person {
  email: string | undefined;
  password: string | undefined;
  key: string | undefined;
}

/** Signs in, setting up the authenticator app on the first run and using its key after. */
async function signIn(page: Page, who: Person, name: string): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(who.email ?? '');
  await page.getByLabel('Password', { exact: true }).fill(who.password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();

  if (
    await h1(page, 'Set up your authenticator app')
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
  ) {
    const key = (
      (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent()) ?? ''
    ).replace(/\s/g, '');
    console.info(`Set TPS_E2E_${name}_TOTP_KEY=${key} for the next runs.`);
    await page.getByLabel('Code from your app').fill(await nextCode(key, null));
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await expect(h1(page, 'Enter your code')).toBeVisible();
    await page.getByLabel('Code from your app').fill(await nextCode(who.key ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(h1(page, 'Programmes')).toBeVisible();
}

test.describe('the assessment journey against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack.',
  );
  test.skip(
    MANAGER.email === undefined ||
      MANAGER.password === undefined ||
      REVIEWER.email === undefined ||
      REVIEWER.password === undefined,
    "Needs the seed's Northfield manager and a reviewer: set TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD, TPS_E2E_REVIEWER_EMAIL and TPS_E2E_REVIEWER_PASSWORD.",
  );
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  test('@api a manager has two reviewers assigned to each submission in Review and opens the spread', async ({
    page,
  }) => {
    await signIn(page, MANAGER, 'MANAGER');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Submissions' })
      .click();
    await expect(submissionsTable(page)).toBeVisible();

    await page.getByRole('combobox', { name: 'Round' }).selectOption({ label: 'Autumn 2026' });
    await page.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Review' });
    await expect(submissionRows(page).first()).toBeVisible();

    // The pool is where the list's round filter leads.
    await page.getByRole('link', { name: 'Reviewers' }).click();
    await expect(h1(page, 'Reviewers')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Reviewers in the pool' }).locator('tbody > tr'),
    ).not.toHaveCount(0);
    await page.goBack();

    const count = await submissionRows(page).count();
    const { result } = await assignAutomatically(page, count, 2);
    expect(result).toMatch(/\d+ reviews? assigned\./);

    await page.getByRole('link', { name: 'Score spread' }).click();
    await expect(h1(page, 'Score spread')).toBeVisible();
    await expect(spreadTable(page)).toBeVisible();
    await expect(spreadRows(page).first()).toBeVisible();
  });

  test('@api a reviewer declares a conflict, scores a review by keyboard and submits it', async ({
    page,
  }) => {
    await signIn(page, REVIEWER, 'REVIEWER');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My reviews' })
      .click();
    await expect(h1(page, 'My reviews')).toBeFocused();
    await expect(reviewRows(page).first()).toBeVisible();

    const notStarted = reviewRows(page).filter({ hasText: 'Not started' });
    const before = await reviewRows(page).count();
    expect(await notStarted.count()).toBeGreaterThanOrEqual(2);

    const first = notStarted.first();
    await first.getByRole('rowheader').getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: /^Application / })).toBeVisible();
    await declareConflict(page);
    await expect(reviewRows(page)).toHaveCount(before - 1);

    await notStarted.first().getByRole('rowheader').getByRole('link').click();
    await scoreFromTheKeyboard(page, [5, 4, 4, 3, 5].slice(0, await criteriaCount(page)));
    await submitReview(page);

    await page.getByRole('link', { name: 'Back to My reviews' }).click();
    await expect(reviewRows(page).filter({ hasText: 'Submitted' }).first()).toBeVisible();
  });
});

/** How many criteria the open review asks for. */
async function criteriaCount(page: Page): Promise<number> {
  const panel = page.getByRole('region', { name: 'Your review' });
  await expect(panel).toBeVisible();
  const confirm = panel.getByRole('button', { name: 'I have no conflict, start scoring' });
  if (await confirm.isVisible()) await confirm.click();
  return panel.getByRole('radiogroup').count();
}
