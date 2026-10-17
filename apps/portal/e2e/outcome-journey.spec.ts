// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 13 against the real API, as the applicant sees it: after submitting
// they see "Submitted", and nothing that suggests an outcome, until the
// manager releases the decision; then they see the award. It needs the stack,
// seeded with the published Community Spaces Fund form: `pnpm stack`, then
// `pnpm test:stack -- outcome`. The second test also needs the manager's
// details and the decision routes (outcome-staff.ts). The same screens run
// with the API stubbed in outcome.spec.ts.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  answerQuestions,
  createApplicant,
  h1,
  main,
  passEligibility,
  startApplication,
} from './apply-steps.ts';
import {
  managerIsSet,
  moveToReview,
  recordAward,
  release,
  signInManager,
} from './outcome-staff.ts';

/** Words that give an outcome away, and words from inside the funder. Neither may show before release. */
const OUTCOME_WORDS = /awarded|waiting list|not funded|successful|congratulations|£\d/i;
const INSIDE_WORDS = /score|stage|reviewer|shortlist|rank/i;

/** A new applicant answers every question of the application they start, sends it, and gives its id. */
async function applyAndSubmit(page: Page): Promise<string> {
  await createApplicant(page);
  await startApplication(page);
  await passEligibility(page);

  await page.getByRole('link', { name: /^Continue with / }).click();
  for (;;) {
    const progress = (await page.getByText(/^Section \d+ of \d+/).textContent()) ?? '';
    const [, current = '1', total = '1'] = /Section (\d+) of (\d+)/.exec(progress) ?? [];
    await answerQuestions(page);
    if (current === total) {
      await page.getByRole('button', { name: 'Save and check your answers' }).click();
      break;
    }
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(
      page.getByText(`Section ${String(Number(current) + 1)} of ${total}`),
    ).toBeVisible();
  }
  await expect(h1(page, 'Check your answers')).toBeVisible();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(h1(page, 'Application submitted')).toBeVisible();
  return new URL(page.url()).pathname.split('/')[3] ?? '';
}

/** The applicant's list and application, which say no more than the status. */
async function expectOnlyTheStatus(page: Page, applicationId: string, status: string) {
  await page.goto('/northfield/applications');
  await expect(page.getByText(status, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Read your outcome/ })).toHaveCount(0);
  await expect(main(page)).not.toContainText(OUTCOME_WORDS);
  await expect(main(page)).not.toContainText(INSIDE_WORDS);

  await page.goto(`/northfield/applications/${applicationId}/outcome`);
  await expect(main(page)).toContainText(`: ${status}.`);
  await expect(main(page)).not.toContainText(OUTCOME_WORDS);
  await expect(main(page)).not.toContainText(INSIDE_WORDS);
}

test.describe('an applicant reading their outcome, against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- outcome.',
  );
  test.setTimeout(420_000);

  test('@api sees only "Submitted" after sending, and no outcome area', async ({ page }) => {
    const applicationId = await applyAndSubmit(page);

    await expectOnlyTheStatus(page, applicationId, 'Submitted');
  });

  test('@api sees "Under review" while a decision is recorded, and the award once it is released', async ({
    page,
    browser,
  }) => {
    test.skip(
      !managerIsSet,
      "Needs the seed's Northfield programme manager and the decision routes: set TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and TPS_E2E_MANAGER_TOTP_KEY.",
    );
    const applicationId = await applyAndSubmit(page);
    const manager = await signInManager(browser);

    // Step 12: the manager moves it to Review and records an award. The applicant sees none of it.
    await moveToReview(manager, applicationId);
    await expectOnlyTheStatus(page, applicationId, 'Under review');
    await recordAward(manager, applicationId, 1_250_000);
    await expectOnlyTheStatus(page, applicationId, 'Under review');

    // Step 13: the manager signs in again and releases it.
    await release(manager, applicationId);
    await page.goto('/northfield/applications');
    await expect(page.getByText('Awarded', { exact: true })).toBeVisible();
    await expect(page.getByText('£12,500')).toBeVisible();
    await page.getByRole('link', { name: /^Read your outcome/ }).click();

    await expect(h1(page, 'Your application was successful')).toBeVisible();
    await expect(main(page)).toContainText('You have been awarded £12,500');
    await expect(main(page)).not.toContainText(INSIDE_WORDS);
  });
});
